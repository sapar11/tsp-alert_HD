// ==UserScript==
// @name         IKEA TSP 담당자 알림
// @namespace    fursys.cs
// @version      2.1
// @description  TSP처리예정자가 본인인 건이 재확인요청 상태가 되면 알림
// @match        https://csckms.net/*
// @match        https://*.csckms.net/*
// @include      *csckms.net*
// @all-frames   true
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/sapar11/tsp-alert_HD/main/TSP_Alert.user.js
// @updateURL    https://raw.githubusercontent.com/sapar11/tsp-alert_HD/main/TSP_Alert.user.js
// ==/UserScript==
``
/*
* 이케아 담당자용이다. 협력사(BAROS)용과 보는 방향이 반대다.
*
*   BAROS 쪽   내가 올린 글이 SP로 전달됐나   → 'SP확인중' 으로 바뀌는 순간
*   이케아 쪽   내가 올린 글에 답이 왔나        → '재확인요청' 로 바뀌는 순간
*
* 그래서 같은 게시판을 보면서도 지켜보는 상태가 다르다. 아래 WATCH_STATUS 만
* 고치면 다른 상태로도 바꿀 수 있다.
*
* 이름에 접두어를 안 붙인다
*   협력사 사람은 게시판에 'BAROS_백병찬' 으로 찍히지만 이케아 사람은 그냥 이름이다.
*   그래서 찾는 값도 접두어 없이 '박상억' 그대로다.
*
* 칸을 골라서 본다
*   접두어가 없으니 행 전체 글자에서 이름을 찾으면 '손님이름' 칸에 같은 이름이
*   있을 때 엉뚱한 건이 걸린다. 접수자 칸과 TSP처리예정자 칸만 본다.
*
* 게시판 수집은 여기서 하지 않는다.
*   화면에 보이는 20건만 긁어서는 소급도 안 되고 페이지도 못 넘긴다.
*   알림은 실시간이라야 쓸모가 있고 수집은 하루 한 번이면 충분해서 갈라둔다.
*/
(function () {
  'use strict';
  const SCAN_INTERVAL    = 5000;    // 5초마다 목록 검사
  const REFRESH_INTERVAL = 60000;   // 60초마다 자동 조회
  const DEBUG = false;              // 확인용 로그 (문제 생기면 true)
  const MY_NAME_FIXED = '';   // ← 이 PC 사용자 이름 (이케아 쪽은 접두어 없음)
  /* 어떤 상태로 바뀌면 알릴까.
     '재확인요청' = 협력사가 답을 붙인 순간. 이케아 담당자가 기다리는 지점이다.
     여러 개를 넣으면 그중 하나라도 되는 순간 알린다.
     [중요] 게시판에 찍히는 글자와 한 글자라도 다르면 영영 안 울린다.
     그래서 '지금 상태 보기' 에 목록의 처리상태 값을 세어 보여준다 —
     거기 뜨는 글자를 그대로 여기에 적으면 된다. */
  const WATCH_STATUS = ['재확인요청'];
  /* 비슷한 이름끼리 겹치는 것을 막는다.
     'SP확인중' 을 찾을 때 'SP오더확인중' 이 같이 걸리는 식이라, 제외할 말을 둔다. */
  const STATUS_NOT = ['오더'];
  /* 칸 자리.
     접수번호 칸을 기준으로 몇 칸 뒤인지로 센다. 게시판 머리글이 두 줄로
     묶여 있어(접수정보가 세 칸을 덮는다) 이름으로 찾기보다 이 편이 덜 깨진다.
     열 구성이 바뀌면 여기 숫자만 고치면 된다 — '지금 상태 보기' 로 확인할 수 있다. */
  const OFF_STATUS = 1;   // 접수번호 다음 칸 = 처리상태
  const OFF_WRITER = 10;   // 접수자
  const OFF_TSP    = 6;   // TSP처리예정자
  // 각 건의 '직전 상태' 를 기억 → 다시 그 상태가 되면 재알림
  const wasHit = {};      // { 접수번호: true/false }
  let firstRun = true;
  let myName = null;
  let lastRefresh = 0;
  let lastSearchAt = 0;          // 마지막 자동조회 시각
  let lastSearchHow = '(아직 없음)';  // 무엇으로 눌렀나
  /* 이름이 틀리면 아무 일도 안 일어난다. 그 침묵을 깨려고 세어 둔다. */
  let emptyStreak = 0;
  let warned = false;
  const EMPTY_WARN_AT = 12;      // 5초 × 12 = 1분
  function log(msg, color) {
    if (DEBUG) console.log('%c[TSP알림] ' + msg, 'color:' + (color || 'blue') + ';font-weight:bold');
  }
  // ===== 이름 확보 =====
  function getMyName() {
    /* 저장된 이름이 가장 먼저다.
       메뉴에서 고친 값인데 파일에 적힌 이름에 밀리면 '고쳤는데 왜 그대로냐' 가 된다. */
    let saved = '';
    try { saved = GM_getValue('tspMyName', ''); } catch (e) {}
    if (saved) return saved;
    // 화면의 '○○○ 님 로그인' 표시
    try {
      const body = window.top.document.body.innerText || '';
      const m = body.match(/([가-힣]{2,4})\s*님\s*로그인/);
      if (m) return m[1].replace(/^BAROS_/, '');
    } catch (e) {}
    // 파일에 적어 둔 이름
    if (typeof MY_NAME_FIXED !== 'undefined' && MY_NAME_FIXED) return MY_NAME_FIXED;
    // 입력 요청 (top에서 1회)
    try {
      if (window.self === window.top) {
        const input = prompt('TSP 담당자 알림 설정\n\n본인 이름을 입력하세요 (예: 박상억)', '');
        if (input && input.trim()) {
          GM_setValue('tspMyName', input.trim());
          return input.trim();
        }
      }
    } catch (e) {}
    return null;
  }
  try {
    GM_registerMenuCommand('지금 상태 보기', function () {
      const doc = findListDoc();
      const nm = myName || getMyName() || '';
      let rowsN = 0, mineN = 0, sample = '';
      const bag = {};      // 목록에 실제로 있는 처리상태 값
      if (doc) {
        const rs = doc.querySelectorAll('table tbody tr');
        rs.forEach(tr => {
          const c = cellsOf(tr);
          if (!c) return;
          rowsN++;
          const st = c.status || '(빈칸)';
          bag[st] = (bag[st] || 0) + 1;
          if (rowsN === 1) {
            sample = '\n\n첫 줄에서 읽은 값\n'
              + '  처리상태        : ' + c.status + '\n'
              + '  접수자          : ' + c.writer + '\n'
              + '  TSP처리예정자 : ' + c.tsp;
          }
          if (isMine(c, nm)) mineN++;
        });
      }
      /* 지켜보는 글자가 목록에 실제로 있는지가 핵심이다.
         없으면 이름이 맞아도 영영 안 울린다. */
      const keys = Object.keys(bag).sort((a, b) => bag[b] - bag[a]);
      const hit = keys.some(k => WATCH_STATUS.some(w => k.indexOf(w) >= 0));
      const dist = keys.length
        ? '\n\n목록에 있는 처리상태\n  ' + keys.map(k => k + ' ' + bag[k] + '건').join('\n  ')
          + (hit ? '' : '\n\n※ 지켜보는 「' + WATCH_STATUS.join('·') + '」 가 위에 없습니다.'
                      + '\n   위 글자를 그대로 스크립트 WATCH_STATUS 에 넣어야 울립니다.')
        : '';
      alert('TSP 담당자 알림 상태\n\n'
        + '내 이름 : ' + (nm || '(못 정함)') + '\n'
        + '보는 상태 : ' + WATCH_STATUS.join(' · ') + '\n'
        + '목록    : ' + (doc ? rowsN + '건' : '못 찾음') + '\n'
        + '내 건   : ' + mineN + '건\n'
        + '자동조회 : ' + (lastSearchAt
            ? new Date(lastSearchAt).toLocaleTimeString() + ' · ' + lastSearchHow
            : '아직 안 돌았습니다 (최대 1분)')
        + sample + dist + '\n\n'
        + (rowsN === 0
            ? '목록을 못 찾았습니다. 조회를 한 번 눌러 보세요.'
            : mineN === 0
              ? '내 건이 0건입니다. 위 세 값이 제대로 읽혔는지 보세요.\n'
                + '엉뚱한 칸이 읽혔다면 스크립트 위쪽 OFF_ 숫자를 고쳐야 합니다.'
              : '정상입니다. 내 건이 ' + WATCH_STATUS.join('·') + ' 로 바뀌는 순간 알립니다.'));
    });
  } catch (e) {}
  /* 자동조회가 도는지 60초를 기다려 볼 필요는 없다. 여기서 바로 눌러 본다. */
  try {
    GM_registerMenuCommand('지금 한 번 조회해보기', function () {
      var doc = findListDoc();
      if (!doc) { alert('목록을 못 찾았습니다.'); return; }
      var ok = doSearch(doc);
      lastRefresh = Date.now();
      alert(ok ? ('조회를 실행했습니다.\n\n방법 : ' + lastSearchHow
                  + '\n\n목록이 새로 그려지면 정상입니다.')
               : '조회 버튼도 조회 함수도 못 찾았습니다.\n화면을 캡처해서 알려 주세요.');
    });
  } catch (e) {}
  try {
    GM_registerMenuCommand('내 이름 다시 설정', function () {
      const cur = GM_getValue('tspMyName', '');
      const input = prompt('본인 이름을 입력하세요 (예: 김지은)', cur);
      if (input && input.trim()) {
        GM_setValue('tspMyName', input.trim());
        myName = input.trim();
        emptyStreak = 0; warned = false;
        alert('이름이 "' + input.trim() + '"(으)로 설정되었습니다.');
      }
    });
  } catch (e) {}
  // ===== 행에서 필요한 칸만 꺼낸다 =====
  function cellsOf(tr) {
    const tds = tr.querySelectorAll('td');
    if (!tds.length) return null;
    // 접수번호 칸을 찾아 그 자리를 기준으로 센다
    let iNo = -1;
    for (let i = 0; i < tds.length; i++) {
      if (/\d{8}-\d{7}/.test(tds[i].innerText || '')) { iNo = i; break; }
    }
    if (iNo < 0) return null;
    const at = (off) => {
      const td = tds[iNo + off];
      return td ? String(td.innerText || '').replace(/\s+/g, ' ').trim() : '';
    };
    const no = (tds[iNo].innerText || '').match(/\d{8}-\d{7}/);
    return {
      id:     no ? no[0] : '',
      status: at(OFF_STATUS),
      writer: at(OFF_WRITER),
      tsp:    at(OFF_TSP),
    };
  }
  /* 접수자 또는 TSP처리예정자가 나인가.
     칸 값이 이름 하나뿐이라 '같다' 로 본다 — 포함으로 보면 '박상억' 이
     '박상억외 2명' 같은 표기까지 잡지만, 지금 게시판에는 그런 표기가 없다.
     혹시 몰라 공백만 지운 뒤 견준다. */
function isMine(c, nm) {
  if (!nm) return false;

  const k = (s) =>
    String(s || '')
      .replace(/\s/g, '')
      .replace(/^BAROS_/, '');

  return k(c.tsp) === k(nm);
}
  function isWatched(c) {
    const s = c.status || '';
    for (let i = 0; i < STATUS_NOT.length; i++) {
      if (s.indexOf(STATUS_NOT[i]) >= 0) return false;
    }
    for (let j = 0; j < WATCH_STATUS.length; j++) {
      if (s.indexOf(WATCH_STATUS[j]) >= 0) return true;
    }
    return false;
  }
  function findListDoc() {
    const docs = [];
    function collect(win) {
      try { if (win.document) docs.push(win.document); }
      catch (e) { return; }
      for (let i = 0; i < win.frames.length; i++) {
        try { collect(win.frames[i]); } catch (e) {}
      }
    }
    try { collect(window.top); }
    catch (e) { collect(window); }
    for (const doc of docs) {
      try {
        const rows = doc.querySelectorAll('table tbody tr');
        for (const tr of rows) {
          if (/\d{8}-\d{7}/.test(tr.innerText || '')) return doc;
        }
      } catch (e) {}
    }
    return null;
  }
  /* 자동조회.
     예전에는 onclick 속성에 whenSearch 가 들어 있는 버튼만 찾았다.
     이 사이트가 jQuery 로 이벤트를 붙였다면 그 속성이 비어 있어 못 찾고,
     실패해도 아무 말이 없으니 도는지 안 도는지 알 수가 없었다.
     그래서 두 가지를 바꿨다.
       · 글자에 '조회' 가 들어간 버튼이면 속성을 안 보고 그냥 누른다
       · 무엇으로 성공했는지 적어 둔다 — '지금 상태 보기' 에서 확인할 수 있다
     a 태그는 건드리지 않는다. 눌렀다가 다른 화면으로 넘어가면 더 곤란하다. */
  function doSearch(doc) {
    try {
      var cand = [];
      var list = doc.querySelectorAll('button, input[type=button], input[type=submit]');
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        var t = String(b.innerText || b.value || '').replace(/\s/g, '');
        if (t.indexOf('조회') >= 0) cand.push(b);
      }
      if (cand.length) {
        cand[0].click();
        lastSearchAt = Date.now();
        lastSearchHow = '조회 버튼 클릭';
        log('자동조회 실행 (버튼클릭)', 'red');
        return true;
      }
    } catch (e) {}
    /* 버튼을 못 찾으면 페이지가 가진 조회 함수를 직접 부른다.
       이름이 사이트마다 달라 몇 가지를 차례로 시도한다. */
    try {
      var s = doc.createElement('script');
      s.textContent =
        "(function(){var f=['whenSearch','fnSearch','goSearch','doSearch','search'];"
        + "for(var i=0;i<f.length;i++){try{if(typeof window[f[i]]==='function'){window[f[i]]('1');"
        + "window.__tspSearchOk=f[i];return;}}catch(e){}}"
        + "for(var j=0;j<f.length;j++){try{if(typeof window[f[j]]==='function'){window[f[j]]();"
        + "window.__tspSearchOk=f[j];return;}}catch(e){}}})();";
      (doc.head || doc.documentElement).appendChild(s);
      s.remove();
      var got = '';
      try { got = doc.defaultView.__tspSearchOk || ''; } catch (e) {}
      lastSearchAt = Date.now();
      lastSearchHow = got ? ('페이지 함수 ' + got + '()') : '함수 주입 (확인 불가)';
      log('자동조회 실행 (함수주입)', 'red');
      return true;
    } catch (e) {}
    lastSearchHow = '실패 — 조회 버튼도 함수도 못 찾음';
    return false;
  }
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; g.gain.value = 0.2;
      o.start(); o.stop(ctx.currentTime + 0.25);
    } catch (e) {}
  }
  function scan() {
    const doc = findListDoc();
    if (!doc) { log('scan / 목록없음'); return; }
    if (!myName) {
      myName = getMyName();
      if (!myName) { log('scan / 이름미설정'); return; }
    }
    log('scan / 목록YES / 이름=' + myName);
    const now = Date.now();
    if (now - lastRefresh > REFRESH_INTERVAL) {
      lastRefresh = now;
      doSearch(doc);
      return;
    }
    const rows = doc.querySelectorAll('table tbody tr');
    const hits = [];
    let seen = 0, mine = 0;
    rows.forEach(tr => {
      const c = cellsOf(tr);
      if (!c || !c.id) return;
      seen++;
      if (!isMine(c, myName)) return;
      mine++;
      const now2 = isWatched(c);
      const before = wasHit[c.id] === true;
      // '이전엔 아니었다 → 지금 그 상태' 로 바뀐 순간에만 알린다
      if (now2 && !before && !firstRun) hits.push(c);
      wasHit[c.id] = now2;
    });
    firstRun = false;
    /* 목록에 행은 있는데 내 건이 한 건도 없다 — 이름이나 칸 자리가 틀렸을 때의 모양이다.
       1분 넘게 그러면 한 번만 알린다. 두 번 이상 띄우면 그게 더 성가시다. */
    if (seen > 0 && mine === 0) {
      if (++emptyStreak >= EMPTY_WARN_AT && !warned) {
        warned = true;
        try {
          GM_notification({
            title: '⚠ TSP 알림 — 내 건이 안 잡힙니다',
            text: '이름을 "' + myName + '" 으로 찾고 있는데 목록 ' + seen
                + '건 중 하나도 안 맞습니다.\n'
                + 'Tampermonkey 메뉴 > 지금 상태 보기 로 어느 칸을 읽고 있는지 확인하세요.',
            timeout: 20000,
          });
        } catch (e) {}
        console.warn('[TSP알림] 이름 "' + myName + '" 으로 잡히는 건이 없습니다. 목록 ' + seen + '건.');
      }
    } else if (mine > 0) {
      emptyStreak = 0;
      warned = false;
    }
    hits.forEach(c => {
      beep();
      GM_notification({
        title: '🔔 ' + c.status + ' (' + myName + ')',
        text: '접수번호 ' + c.id + '\n'
            + (c.writer ? '접수자 ' + c.writer : '')
            + (c.tsp ? ' · TSP ' + c.tsp : ''),
        timeout: 15000,
        onclick: () => { try { window.top.focus(); } catch (e) { window.focus(); } }
      });
    });
  }
  /* 누가 타이머를 돌 것인가.
     예전에는 '맨 바깥 창(top)' 만 돌았다. 그런데 이 게시판은 목록이 프레임 안에
     들어 있어서, 바깥 사본이 프레임을 못 잡으면 아무도 아무것도 안 한다.
     프레임 쪽 사본은 자기가 top 이 아니라는 이유로 가만히 있었다.
     그래서 '먼저 깨어난 사본이 맡는다' 로 바꾼다. 같은 도메인이라 어느 사본이든
     다른 프레임을 들여다볼 수 있고, top 에 깃발을 하나 꽂아 두면 둘이 겹쳐 돌지 않는다.
     프레임을 못 읽는 상황이면 예전처럼 top 만 돈다. */
  var owner = false;
  try {
    if (!window.top.__tspAlertOwner) { window.top.__tspAlertOwner = true; owner = true; }
  } catch (e) {
    owner = (window.self === window.top);
  }
  if (owner) {
    log('스크립트 시작됨', 'green');
    setInterval(scan, SCAN_INTERVAL);
    scan();
  }
})();
