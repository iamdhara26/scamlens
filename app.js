(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const STORAGE_KEY = 'scamlens_history_v2';
  const MAX_HISTORY = 100;
  const MAX_INPUT = 5000;

  let storageWarned = false;
  let historyItems = readHistory();

  /* ---------- Storage ---------- */
  function readHistory() {
    try {
      const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(historyItems.slice(0, MAX_HISTORY)));
    } catch {
      if (!storageWarned) {
        storageWarned = true;
        notify('Browser storage is unavailable. History may not persist.');
      }
    }
    renderStats();
    renderHistory();
    renderHomeHistory();
  }

  /* ---------- Helpers ---------- */
  function notify(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  const riskLabel = (s) => (s >= 60 ? 'High risk' : s >= 30 ? 'Caution' : 'Lower indicator score');
  const riskClass = (s) => (s >= 60 ? 'high' : s >= 30 ? 'medium' : 'low');
  const riskColor = (s) => (s >= 60 ? '#ff7188' : s >= 30 ? '#ffcb70' : '#50d9a6');

  /* ---------- Navigation ---------- */
  function setView(id) {
    const target = document.getElementById(id);
    if (!target || !target.classList.contains('view')) return false;
    $$('.view').forEach((s) => s.classList.toggle('active', s.id === id));
    $$('.nav-link').forEach((a) => {
      const on = a.dataset.view === id;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    return true;
  }

  function go(id) {
    if (!setView(id)) return;
    try {
      if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
    } catch { /* sandboxed contexts may forbid this */ }
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    if (id === 'history') renderHistory();
  }

  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-view]');
    const link = e.target.closest('[data-go]');
    if (nav) { e.preventDefault(); go(nav.dataset.view); }
    else if (link) { e.preventDefault(); go(link.dataset.go); }
  });

  window.addEventListener('hashchange', () => setView(location.hash.slice(1)));

  /* ---------- Rendering ---------- */
  function saveScan(type, input, result) {
    historyItems.unshift({
      id: Date.now() + Math.random(),
      type,
      input: input.slice(0, 220),
      score: result.score,
      flags: result.flags.length,
      date: new Date().toISOString()
    });
    persist();
  }

  function renderStats() {
    const total = historyItems.length;
    const flagged = historyItems.filter((x) => x.score >= 30).length;
    $('#totalScans').textContent = total;
    $('#flaggedScans').textContent = flagged;
    $('#lowerScans').textContent = total - flagged;
  }

  function historyRow(item) {
    return `<div class="history-row"><div><b title="${escapeHTML(item.input)}">${escapeHTML(item.input)}</b><small>${escapeHTML(item.type)} scan · ${item.flags} indicator(s)</small></div><span class="badge ${riskClass(item.score)}">${item.score}/100 · ${riskLabel(item.score)}</span><small class="history-date">${new Date(item.date).toLocaleString()}</small></div>`;
  }

  function renderHistory() {
    $('#historyList').innerHTML = historyItems.length
      ? historyItems.map(historyRow).join('')
      : '<div class="empty-state"><span>◷</span><b>No scan history</b><p>Run a scan to see it here.</p></div>';
  }

  function renderHomeHistory() {
    $('#homeHistory').innerHTML = historyItems.length
      ? historyItems.slice(0, 4).map(historyRow).join('')
      : '<div class="empty-state"><span>◷</span><b>No scans yet</b><p>Your recent scans will appear here.</p></div>';
  }

  function showResult(container, result, kind) {
    const { score, flags } = result;
    const advice = score >= 60
      ? 'Do not click links, pay money or share sensitive information. Verify through an independently found official channel. If money has been lost, contact your bank and report it promptly.'
      : score >= 30
        ? 'Pause and verify independently. Do not share sensitive information or make payments based only on this message.'
        : 'No patterns from this small rule set matched strongly. This does not prove the message or URL is genuine or safe.';

    const flagHTML = flags.length
      ? flags.map((f) => `<div class="flag"><span class="flag-mark">⚑</span><div><b>${escapeHTML(f.title)}</b><small>${escapeHTML(f.desc)}</small></div></div>`).join('')
      : `<div class="empty-state"><b>No listed patterns found</b><p>${kind === 'URL inspection'
        ? 'This rule set has not checked the website’s reputation or content.'
        : 'New or cleverly worded scams may not match these rules.'}</p></div>`;

    container.innerHTML = `<div class="result-card"><div class="result-top"><div class="score-ring" style="--score:${score}%;--score-color:${riskColor(score)}"><b>${score}</b></div><div><div class="risk-title">${riskLabel(score)}</div><div class="risk-sub">${kind} · Heuristic warning score / 100</div><span class="badge ${riskClass(score)}">${flags.length} indicator(s) found</span></div></div><div class="flag-list">${flagHTML}</div><div class="advice-box"><b>What to do next</b><br>${advice}</div><p class="result-disclaimer">This score is produced by simple local rules, not AI or a verified fraud database. It is not a probability or safety certification.</p></div>`;
  }

  /* ---------- Message analysis ---------- */
  const messageRules = [
    { re: /\b(otp|one[- ]time password|verification code|upi pin|pin number|password|cvv)\b/i, points: 30, title: 'Sensitive credential mentioned', desc: 'The message refers to an OTP, PIN, password, CVV or verification code. Never disclose these to another person.' },
    { re: /\b(won|winner|lottery|lucky draw|cash prize|claim your prize|congratulations)\b/i, points: 22, title: 'Unexpected prize or reward', desc: 'Unexpected winnings can be used to lure people into paying fees or sharing personal information.' },
    { re: /\b(urgent|immediately|within \d+ minutes?|act now|limited time|last warning|expires today|final notice)\b/i, points: 16, title: 'Urgency or pressure tactic', desc: 'The sender is pressuring you to act quickly instead of giving you time to verify the claim.' },
    { re: /\b(blocked|suspend(ed)?|deactivat(e|ed)|account will be closed|legal action|police case)\b/i, points: 16, title: 'Threat of account closure or action', desc: 'Threatening language can create fear and push you into clicking or responding.' },
    { re: /\b(kyc|verify your account|update your account|bank details|card details|aadhaar|pan card)\b/i, points: 14, title: 'Account or identity verification request', desc: 'Unexpected requests to update KYC or share identity/banking details should be verified independently.' },
    { re: /\b(registration fee|processing fee|pay.{0,40}to receive|advance payment|security deposit|refundable fee)\b/i, points: 22, title: 'Advance payment request', desc: 'Requests to pay money upfront for a prize, job or benefit are a common warning sign.' },
    { re: /\b(work from home|earn ₹?[\d,]+|daily income|guaranteed income|no experience required)\b/i, points: 12, title: 'Unusually attractive earning offer', desc: 'High or guaranteed earnings for little effort can be a tactic used in fake job and task scams.' },
    { re: /\b(click here|tap here|follow this link|verify now|claim now)\b/i, points: 9, title: 'Prompt to click a link', desc: 'Avoid opening unexpected links. Visit the official service through a known route instead.' },
    { re: /https?:\/\/\S+/i, points: 10, title: 'Link included in message', desc: 'Unexpected links can lead to imitation websites or credential-harvesting pages.' },
    { re: /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|rb\.gy|is\.gd)\/\S+/i, points: 10, title: 'Shortened link', desc: 'Link shorteners hide the real destination, so you cannot judge the site before opening it.' },
    { re: /\b(anydesk|teamviewer|quicksupport|rustdesk|screen ?share)\b/i, points: 25, title: 'Remote-access app mentioned', desc: 'Scammers ask people to install remote-control apps to see screens and OTPs or move money. Never install one at a stranger’s request.' },
    { re: /\b(send|share|tell me|provide).{0,35}\b(otp|pin|password|cvv)\b/i, points: 25, title: 'Possible request for secret credentials', desc: 'A request to send a PIN, OTP, password or CVV is a serious warning sign.' }
  ];

  function analyzeMessage(text) {
    const flags = [];
    let score = 0;
    const input = text.slice(0, MAX_INPUT);
    for (const rule of messageRules) {
      if (rule.re.test(input)) {
        flags.push({ title: rule.title, desc: rule.desc });
        score += rule.points;
      }
    }
    return { score: Math.min(100, score), flags };
  }

  /* ---------- URL analysis ---------- */
  const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'cutt.ly', 'rb.gy', 'is.gd', 'ow.ly'];
  const RISKY_TLDS = ['zip', 'mov', 'top', 'xyz', 'click', 'buzz', 'icu', 'cfd', 'sbs', 'tk'];
  const BRANDS = {
    sbi: ['sbi.co.in', 'onlinesbi.sbi'],
    hdfc: ['hdfcbank.com'],
    icici: ['icicibank.com'],
    paytm: ['paytm.com'],
    phonepe: ['phonepe.com'],
    amazon: ['amazon.in', 'amazon.com'],
    flipkart: ['flipkart.com'],
    npci: ['npci.org.in'],
    paypal: ['paypal.com']
  };
  const SENSITIVE_WORDS = ['login', 'verify', 'secure', 'account', 'update', 'gift', 'prize', 'wallet', 'banking', 'free', 'claim'];

  const isOfficial = (host, domains) => domains.some((d) => host === d || host.endsWith('.' + d));

  function analyzeURL(raw) {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url;
    try { url = new URL(candidate); }
    catch { return { error: 'That URL could not be parsed. Check its spelling and try again.' }; }
    if (!['http:', 'https:'].includes(url.protocol)) return { error: 'Only HTTP or HTTPS web addresses can be inspected.' };
    if (!url.hostname || !url.hostname.includes('.')) return { error: 'Enter a complete domain name, such as example.com.' };

    const host = url.hostname.toLowerCase();
    const tld = host.split('.').pop();
    const flags = [];
    let score = 0;
    const add = (points, title, desc) => {
      if (!flags.some((f) => f.title === title)) { flags.push({ title, desc }); score += points; }
    };

    if (url.protocol !== 'https:') add(15, 'Not using HTTPS', 'The URL uses HTTP. HTTPS is preferable, but HTTPS alone does not prove a site is trustworthy.');
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) add(25, 'IP address used as hostname', 'A raw IP address instead of a recognizable domain can be suspicious, though some legitimate services use IPs.');
    if (host.includes('xn--')) add(25, 'Punycode domain detected', 'Internationalized domain encoding can sometimes disguise lookalike characters.');
    if (host.split('.').length >= 5) add(12, 'Unusually deep subdomain', 'Several subdomain levels can make it harder to identify the actual registered domain.');
    if ((host.match(/-/g) || []).length >= 3) add(12, 'Several hyphens in domain', 'A heavily hyphenated domain may be crafted to resemble a trusted brand.');
    if (url.username || url.password) add(25, 'Credentials embedded in URL', 'The URL contains user information before the hostname, which can make its destination deceptive.');
    if (SENSITIVE_WORDS.some((w) => host.includes(w))) add(10, 'Sensitive or promotional words in domain', 'Words related to account access, prizes or banking may be used to imitate trusted services.');
    if (host.length > 35) add(8, 'Long hostname', 'An unusually long hostname can make the real domain harder to recognize.');
    if (url.port && !['80', '443'].includes(url.port)) add(8, 'Non-standard port', 'The URL uses a less common port. This can be legitimate but deserves extra scrutiny.');
    if (/%[0-9a-f]{2}/i.test(url.pathname + url.search)) add(7, 'Encoded URL characters', 'Encoded characters can make a destination harder to read. This is not malicious by itself.');
    if (SHORTENERS.includes(host)) add(15, 'Link shortener', 'A shortened link hides its real destination. Expand it with a trusted tool before opening.');
    if (RISKY_TLDS.includes(tld)) add(8, 'Domain ending often seen in abuse', `The “.${tld}” ending is cheap or easy to register and is frequently used in throwaway scam sites. Many legitimate sites exist too.`);
    for (const [brand, domains] of Object.entries(BRANDS)) {
      if (host.includes(brand) && !isOfficial(host, domains)) {
        add(20, 'Possible brand impersonation', `The domain mentions “${brand}” but is not one of that brand’s known official domains. Type the official address yourself instead.`);
        break;
      }
    }

    return { score: Math.min(100, score), flags, host };
  }

  /* ---------- Scanner controls ---------- */
  $('#analyzeMessage').addEventListener('click', () => {
    const text = $('#messageInput').value.trim();
    if (text.length < 8) { notify('Enter a message with at least 8 characters.'); return; }
    const result = analyzeMessage(text);
    showResult($('#messageResult'), result, 'Message scan');
    saveScan('Message', text, result);
    notify('Message analysis complete.');
  });

  $('#sampleMessage').addEventListener('click', () => {
    $('#messageInput').value = 'URGENT: Congratulations! You have won a cash prize of ₹25,00,000. Your bank account will be blocked if you do not verify your KYC immediately. Click here to claim your prize: http://claim-prize-example.com and share your OTP.';
    $('#messageInput').focus();
  });

  $('#clearMessage').addEventListener('click', () => {
    $('#messageInput').value = '';
    $('#messageResult').innerHTML = '';
    notify('Message field cleared.');
  });

  $('#analyzeUrl').addEventListener('click', () => {
    const raw = $('#urlInput').value.trim();
    if (raw.length < 4) { notify('Enter a URL first.'); return; }
    const result = analyzeURL(raw);
    if (result.error) { notify(result.error); return; }
    showResult($('#urlResult'), result, 'URL inspection');
    saveScan('URL', raw, result);
    notify('URL inspection complete.');
  });

  $('#sampleUrl').addEventListener('click', () => {
    $('#urlInput').value = 'http://secure-bank-verify-account-login.example.com/update';
    $('#urlInput').focus();
  });

  $('#clearUrl').addEventListener('click', () => {
    $('#urlInput').value = '';
    $('#urlResult').innerHTML = '';
    notify('URL field cleared.');
  });

  /* ---------- History actions ---------- */
  const clearBtn = $('#clearHistory');
  const clearLabel = clearBtn.textContent;
  let clearArmed = false;
  let clearTimer;

  clearBtn.addEventListener('click', () => {
    if (!historyItems.length) { notify('There is no history to clear.'); return; }
    if (!clearArmed) {
      clearArmed = true;
      clearBtn.textContent = 'Click again to confirm';
      clearTimer = setTimeout(() => { clearArmed = false; clearBtn.textContent = clearLabel; }, 4000);
      return;
    }
    clearTimeout(clearTimer);
    clearArmed = false;
    clearBtn.textContent = clearLabel;
    historyItems = [];
    persist();
    notify('Scan history cleared.');
  });

  // Prevent spreadsheet formula injection when the CSV is opened in Excel/Sheets.
  const csvCell = (v) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };

  $('#exportHistory').addEventListener('click', () => {
    if (!historyItems.length) { notify('There is no history to export.'); return; }
    const rows = [
      ['Date', 'Type', 'Input', 'Score', 'Risk level', 'Indicators'],
      ...historyItems.map((x) => [x.date, x.type, x.input, x.score, riskLabel(x.score), x.flags])
    ];
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    try {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'scamlens-history.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('CSV export downloaded.');
    } catch {
      notify('Export is not available in this environment.');
    }
  });

  /* ---------- Quiz ---------- */
  const questions = [
    { q: 'A stranger asks you to share an OTP to receive a payment. What should you do?', o: ['Share it if they sound official', 'Never share it; a UPI PIN or OTP is not needed to receive money', 'Send only the first few digits'], a: 1, e: 'Keep OTPs and PINs private. A UPI PIN authorizes a payment; it is not needed to receive money.' },
    { q: 'You receive a message saying your bank account will close in 10 minutes. What is safest?', o: ['Click the message link immediately', 'Reply with your account number', 'Open the official bank app or contact the bank through a known channel'], a: 2, e: 'Do not use the message link. Verify the claim through a channel you independently know is genuine.' },
    { q: 'A recruiter offers a high-paying job but asks for a registration fee first. What is the warning sign?', o: ['An upfront payment request', 'A video interview', 'A company email address'], a: 0, e: 'Requests for money to secure a job are a common warning sign. Verify the employer independently.' },
    { q: 'A website has HTTPS and a padlock. Does that guarantee it is genuine?', o: ['Yes, always', 'No. HTTPS encrypts the connection but does not prove the site is trustworthy', 'Only on mobile'], a: 1, e: 'Scam websites can also use HTTPS. Check the exact domain and verify through an official route.' },
    { q: 'You suspect financial cyber fraud in India. What should you do?', o: ['Wait a few days', 'Delete all messages', 'Contact your bank promptly and call 1930 / report at cybercrime.gov.in'], a: 2, e: 'Act quickly: contact your bank and report financial cyber fraud through official channels.' }
  ];
  let questionIndex = 0, quizScore = 0, answered = false;

  function drawQuestion() {
    const q = questions[questionIndex];
    answered = false;
    $('#quizProgress').textContent = `Question ${questionIndex + 1} of ${questions.length}`;
    $('#quizScore').textContent = `SCORE ${quizScore}`;
    $('#quizBar').style.width = `${((questionIndex + 1) / questions.length) * 100}%`;
    $('#quizQuestion').textContent = q.q;
    $('#quizOptions').innerHTML = q.o.map((o, i) => `<button class="quiz-option" data-answer="${i}">${String.fromCharCode(65 + i)}. ${escapeHTML(o)}</button>`).join('');
    $('#quizFeedback').classList.add('hidden');
    const next = $('#nextQuestion');
    next.disabled = true;
    next.classList.remove('hidden');
    next.textContent = questionIndex === questions.length - 1 ? 'See results →' : 'Next question →';
    $('#restartQuiz').classList.add('hidden');
  }

  // One delegated listener instead of re-binding on every question.
  $('#quizOptions').addEventListener('click', (e) => {
    const btn = e.target.closest('.quiz-option');
    if (btn) chooseAnswer(Number(btn.dataset.answer));
  });

  function chooseAnswer(choice) {
    if (answered) return;
    answered = true;
    const q = questions[questionIndex];
    const correct = choice === q.a;
    if (correct) quizScore++;
    $$('.quiz-option').forEach((b, i) => {
      b.disabled = true;
      if (i === q.a) b.classList.add('correct');
      else if (i === choice) b.classList.add('wrong');
    });
    $('#quizScore').textContent = `SCORE ${quizScore}`;
    $('#quizFeedback').textContent = (correct ? 'Correct! ' : 'Not quite. ') + q.e;
    $('#quizFeedback').classList.remove('hidden');
    $('#nextQuestion').disabled = false;
  }

  $('#nextQuestion').addEventListener('click', () => {
    if (!answered) return;
    if (questionIndex < questions.length - 1) {
      questionIndex++;
      drawQuestion();
    } else {
      $('#quizProgress').textContent = 'Quiz complete';
      $('#quizQuestion').textContent = `You scored ${quizScore} out of ${questions.length}.`;
      $('#quizOptions').innerHTML = '';
      $('#quizFeedback').textContent = quizScore === questions.length
        ? 'Excellent! You know several important digital safety habits.'
        : 'Good effort. Review the Safety Academy and try again.';
      $('#quizFeedback').classList.remove('hidden');
      $('#nextQuestion').classList.add('hidden');
      $('#restartQuiz').classList.remove('hidden');
    }
  });

  $('#restartQuiz').addEventListener('click', () => {
    questionIndex = 0;
    quizScore = 0;
    drawQuestion();
  });

  /* ---------- Init ---------- */
  $('#year').textContent = new Date().getFullYear();
  renderStats();
  renderHistory();
  renderHomeHistory();
  drawQuestion();
  setView(location.hash.slice(1));
})();
