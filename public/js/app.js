var currentDeathNotePage = 1;
var currentDeathNoteNickname = '';
var currentCalendarDate = new Date();
var selectedDate = null;
var availableDates = [];
var allDaysData = [];
var pageNickname = '';
var calendarExpanded = false;
var currentViewDate = null;
var allStatsData = null;

var mapNames = {};
var gameModes = {};
var weaponNames = {};

async function loadGameDataI18n() {
  try {
    var response = await fetch(getApiBase() + '/death-note/i18n/game-data');
    if (response.ok) {
      var data = await response.json();
      if (data.success) {
        mapNames = data.maps || {};
        gameModes = data.gameModes || {};
        weaponNames = data.weapons || {};
        console.log('Game data i18n loaded successfully');
      }
    }
  } catch (e) {
    console.warn('Failed to load game data i18n:', e);
  }
}

function translateMap(mapName) {
  if (!mapName) return '未知';
  return mapNames[mapName] || mapName;
}

function translateMode(modeName) {
  if (!modeName) return '未知';
  return gameModes[modeName] || modeName;
}

function formatWeapon(weaponId) {
  if (!weaponId) return '未知';
  if (weaponNames[weaponId]) return weaponNames[weaponId];
  return weaponId;
}

function getApiBase() {
  return window.location.origin + '/api/v1';
}

function showLoading(elementId) {
  var el = document.getElementById(elementId);
  el.className = 'result show';
  el.innerHTML = '<div class="loading">加载中</div>';
}

function showError(elementId, message) {
  var el = document.getElementById(elementId);
  el.className = 'result show error';
  el.innerHTML = '<div class="result-title">错误</div><p>' + escapeHtml(message) + '</p>';
}

function showSuccess(elementId, html) {
  var el = document.getElementById(elementId);
  el.className = 'result show success';
  el.innerHTML = html;
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '未知';
  var date = new Date(dateStr);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDistance(centimeters) {
  var meters = centimeters / 100;
  if (meters >= 1000) {
    return (meters / 1000).toFixed(2) + ' km';
  }
  if (meters >= 100) {
    return Math.round(meters) + ' m';
  }
  if (meters >= 1) {
    return meters.toFixed(1) + ' m';
  }
  return Math.round(centimeters) + ' cm';
}

function toggleCalendar() {
  var section = document.getElementById('calendarSection');
  section.classList.toggle('show');
  if (section.classList.contains('show')) {
    calendarExpanded = false;
    renderCalendar();
  }
}

function toggleCalendarExpand() {
  calendarExpanded = !calendarExpanded;
  renderCalendar();
}

function renderCalendar() {
  var year = currentCalendarDate.getFullYear();
  var month = currentCalendarDate.getMonth();
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var grid = document.getElementById('calendarGrid');
  var weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  var html = weekdays.map(function (d) {
    return '<div class="calendar-weekday">' + d + '</div>';
  }).join('');

  var titleEl = document.getElementById('calendarTitle');

  if (!calendarExpanded) {
    var dayOfWeek = currentCalendarDate.getDay();
    var weekStart = new Date(currentCalendarDate);
    weekStart.setDate(currentCalendarDate.getDate() - dayOfWeek);

    var weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    titleEl.innerHTML = formatWeekRange(weekStart, weekEnd) + '<span class="calendar-expand-hint">点击展开整月</span>';

    for (var i = 0; i < 7; i++) {
      var d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      var dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      var classes = 'calendar-day';
      if (d.getTime() === today.getTime()) classes += ' today';
      if (selectedDate === dateStr) classes += ' selected';
      if (availableDates.indexOf(dateStr) !== -1) classes += ' has-kills';

      html += '<div class="' + classes + '" onclick="selectDate(\'' + dateStr + '\')">' + d.getDate() + '</div>';
    }
  } else {
    titleEl.innerHTML = year + '年' + (month + 1) + '月' + '<span class="calendar-expand-hint">点击收起</span>';

    var firstDay = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var prevMonthDays = new Date(year, month, 0).getDate();

    for (var i = firstDay - 1; i >= 0; i--) {
      html += '<div class="calendar-day other-month">' + (prevMonthDays - i) + '</div>';
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var dateObj = new Date(year, month, day);
      dateObj.setHours(0, 0, 0, 0);

      var classes = 'calendar-day';
      if (dateObj.getTime() === today.getTime()) classes += ' today';
      if (selectedDate === dateStr) classes += ' selected';
      if (availableDates.indexOf(dateStr) !== -1) classes += ' has-kills';

      html += '<div class="' + classes + '" onclick="selectDate(\'' + dateStr + '\')">' + day + '</div>';
    }

    var totalCells = firstDay + daysInMonth;
    var remaining = (7 - (totalCells % 7)) % 7;
    for (var j = 1; j <= remaining; j++) {
      html += '<div class="calendar-day other-month">' + j + '</div>';
    }
  }

  grid.innerHTML = html;
}

function formatWeekRange(start, end) {
  var sMonth = start.getMonth() + 1;
  var eMonth = end.getMonth() + 1;
  if (sMonth === eMonth) {
    return start.getFullYear() + '年' + sMonth + '月 ' + start.getDate() + '日 - ' + end.getDate() + '日';
  }
  return start.getFullYear() + '年' + sMonth + '月' + start.getDate() + '日 - ' + eMonth + '月' + end.getDate() + '日';
}

function calendarPrev() {
  if (!currentViewDate) return;
  var d = new Date(currentViewDate);
  d.setDate(d.getDate() - 1);
  currentViewDate = d;
  currentCalendarDate = new Date(d);
  renderCalendar();
  loadDateData(d);
}

function calendarNext() {
  if (!currentViewDate) return;
  var d = new Date(currentViewDate);
  d.setDate(d.getDate() + 1);
  currentViewDate = d;
  currentCalendarDate = new Date(d);
  renderCalendar();
  loadDateData(d);
}

function calendarPrevCycle() {
  if (!currentViewDate) return;
  var d = new Date(currentViewDate);
  if (calendarExpanded) {
    d.setMonth(d.getMonth() - 1);
  } else {
    d.setDate(d.getDate() - 7);
  }
  currentViewDate = d;
  currentCalendarDate = new Date(d);
  renderCalendar();
  loadDateData(d);
}

function calendarNextCycle() {
  if (!currentViewDate) return;
  var d = new Date(currentViewDate);
  if (calendarExpanded) {
    d.setMonth(d.getMonth() + 1);
  } else {
    d.setDate(d.getDate() + 7);
  }
  currentViewDate = d;
  currentCalendarDate = new Date(d);
  renderCalendar();
  loadDateData(d);
}

function loadDateData(date) {
  if (!currentDeathNoteNickname) return;
  var dateStr = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  selectedDate = dateStr;
  renderCalendar();
  fetchDateData(dateStr);
}

async function fetchDateData(dateStr) {
  try {
    var url = getApiBase() + '/death-note/nickname/' + encodeURIComponent(currentDeathNoteNickname) + '/matches?date=' + dateStr;
    var response = await fetch(url);
    var data = await response.json();

    if (!response.ok || !data.success) {
      return;
    }

    if (data.days.length === 0) {
      showSuccess('result-deathnote',
        '<div class="result-title">死亡笔记 - ' + dateStr + '</div>' +
        '<div class="empty-state">该日期没有击杀记录</div>'
      );
      return;
    }

    renderDays(data.days, dateStr);

    var resultEl = document.getElementById('result-deathnote');
    var statsHtml = buildStatsHtml(data);
    resultEl.innerHTML = statsHtml + resultEl.innerHTML;
  } catch (error) {
    console.error('Failed to load date data:', error);
  }
}

function buildStatsHtml(data) {
  return '<div class="stat-row">' +
    '<span class="stat-label">玩家</span>' +
    '<span class="stat-value">' + escapeHtml(data.nickname) + '</span>' +
    '</div>' +
    (data.startDate && data.endDate ?
      '<div class="stat-row">' +
      '<span class="stat-label">数据范围</span>' +
      '<span class="stat-value">' + data.startDate + ' ~ ' + data.endDate + '</span>' +
      '</div>' : '') +
    '<div class="stat-row">' +
    '<span class="stat-label">总击杀</span>' +
    '<span class="stat-value" style="color:#2ed573">' + data.totalKills + '</span>' +
    '</div>' +
    '<div class="stat-row">' +
    '<span class="stat-label">总死亡</span>' +
    '<span class="stat-value" style="color:#ff4757">' + data.totalDeaths + '</span>' +
    '</div>' +
    '<div class="stat-row">' +
    '<span class="stat-label">比赛场次</span>' +
    '<span class="stat-value">' + data.totalMatches + '</span>' +
    '</div>';
}

function selectDate(dateStr) {
  selectedDate = dateStr;
  var d = new Date(dateStr + 'T00:00:00');
  currentViewDate = d;
  currentCalendarDate = new Date(d);
  renderCalendar();
  fetchDateData(dateStr);
}

function filterByDate(dateStr) {
  var filteredDays = allDaysData.filter(function (day) {
    return day.date === dateStr;
  });

  if (filteredDays.length === 0) {
    showSuccess('result-deathnote',
      '<div class="result-title">死亡笔记 - ' + dateStr + '</div>' +
      '<div class="empty-state">该日期没有击杀记录</div>'
    );
    return;
  }

  renderDays(filteredDays, dateStr);
}

function renderDays(days, title) {
  var daysHtml = days.map(function (day) {
    var matchesHtml = day.matches.map(function (match, idx) {
      var killsHtml = '';
      if (match.killDetails.length > 0) {
        killsHtml = '<div class="kill-section-title">击杀</div>' + match.killDetails.map(function (kill) {
          return '<div class="kill-item">' +
            '<div class="kill-left">' +
            '<span class="kill-weapon">' + escapeHtml(formatWeapon(kill.weaponId)) + '</span>' +
            '<span class="kill-victim">' + escapeHtml(kill.victimName) + '</span>' +
            '</div>' +
            '<div class="kill-right">' +
            (kill.isHeadshot ? '<span class="kill-headshot">爆头</span>' : '') +
            '<span class="kill-distance">' + formatDistance(kill.distance) + '</span>' +
            '</div>' +
            '</div>';
        }).join('');
      }

      var deathsHtml = '';
      if (match.deathDetails.length > 0) {
        deathsHtml = '<div class="death-section-title">被击杀</div>' + match.deathDetails.map(function (death) {
          return '<div class="kill-item death-item">' +
            '<div class="kill-left">' +
            '<span class="kill-weapon">' + escapeHtml(formatWeapon(death.weaponId)) + '</span>' +
            '<span class="kill-victim">被 <strong>' + escapeHtml(death.killerName) + '</strong> 击杀</span>' +
            '</div>' +
            '<div class="kill-right">' +
            (death.isHeadshot ? '<span class="kill-headshot">爆头</span>' : '') +
            '<span class="kill-distance">' + formatDistance(death.distance) + '</span>' +
            '</div>' +
            '</div>';
        }).join('');
      }

      var matchId = 'match-' + day.date + '-' + idx;

      return '<div class="match-card">' +
        '<div class="match-header" onclick="toggleMatch(\'' + matchId + '\')">' +
        '<div class="match-info">' +
        '<span class="match-map">' + escapeHtml(translateMap(match.mapName)) + '</span>' +
        '<span class="match-mode">' + escapeHtml(translateMode(match.gameMode)) + '</span>' +
        '<span class="match-time">' + formatDate(match.matchTime) + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;">' +
        '<div class="match-stats">' +
        '<div class="match-stat">' +
        '<div class="match-stat-value kills">' + match.kills + '</div>' +
        '<div class="match-stat-label">击杀</div>' +
        '</div>' +
        '<div class="match-stat">' +
        '<div class="match-stat-value deaths">' + match.deaths + '</div>' +
        '<div class="match-stat-label">死亡</div>' +
        '</div>' +
        '</div>' +
        '<span class="match-toggle" id="' + matchId + '-toggle">▶</span>' +
        '</div>' +
        '</div>' +
        '<div class="match-details" id="' + matchId + '-details">' +
        '<div class="match-details-inner">' + killsHtml + deathsHtml + '</div>' +
        '</div>' +
        '</div>';
    }).join('');

    return '<div class="day-card">' +
      '<div class="day-header" onclick="toggleDay(this)">' +
      '<span class="day-date">' + (day.date === 'unknown' ? '未知日期' : day.date) + '</span>' +
      '<div class="day-stats">' +
      '<span class="day-stat">' + day.matches.length + ' 场</span>' +
      '<span class="day-stat kills">' + day.kills + ' 杀</span>' +
      '<span class="day-stat deaths">' + day.deaths + ' 死</span>' +
      '</div>' +
      '</div>' +
      '<div class="day-matches">' + matchesHtml + '</div>' +
      '</div>';
  }).join('');

  var paginationHtml = '';
  if (allDaysData.length > days.length) {
    paginationHtml = '<div class="pagination">' +
      '<button class="page-btn" onclick="showAllDays()">显示全部</button>' +
      '</div>';
  }

  showSuccess('result-deathnote',
    '<div class="result-title">死亡笔记' + (title ? ' - ' + title : '') + '</div>' +
    '<div style="margin-top: 15px;">' + daysHtml + '</div>' +
    paginationHtml
  );
}

function showAllDays() {
  selectedDate = null;
  renderCalendar();
  if (allDaysData.length > 0) {
    renderDays(allDaysData, '');
    var resultEl = document.getElementById('result-deathnote');
    if (allStatsData) {
      var statsHtml = buildStatsHtml(allStatsData);
      resultEl.innerHTML = statsHtml + resultEl.innerHTML;
    }
  }
}

function toggleMatch(matchId) {
  var details = document.getElementById(matchId + '-details');
  var toggle = document.getElementById(matchId + '-toggle');
  if (!details || !toggle) return;

  if (details.classList.contains('expanded')) {
    details.classList.remove('expanded');
    toggle.classList.remove('expanded');
  } else {
    details.classList.add('expanded');
    toggle.classList.add('expanded');
  }
}

function toggleDay(headerEl) {
  var dayCard = headerEl.closest('.day-card');
  var matches = dayCard.querySelector('.day-matches');
  if (!matches) return;

  if (matches.style.display === 'none') {
    matches.style.display = 'block';
  } else {
    matches.style.display = 'none';
  }
}

function copyShareLink() {
  var url = document.getElementById('shareLinkUrl').textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(function () {
      alert('链接已复制');
    });
  } else {
    var input = document.createElement('input');
    input.value = url;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    alert('链接已复制');
  }
}

async function queryVictimHistory() {
  var targetNickname = document.getElementById('victim-target').value.trim();

  if (!pageNickname) {
    alert('请先查询死亡笔记');
    return;
  }

  if (!targetNickname) {
    alert('请填写另一位玩家昵称');
    return;
  }

  var btn = document.getElementById('btn-victim');
  btn.disabled = true;
  showLoading('result-victim');

  try {
    var url1 = getApiBase() + '/death-note/nickname/' + encodeURIComponent(pageNickname) + '/victim/' + encodeURIComponent(targetNickname);
    var url2 = getApiBase() + '/death-note/nickname/' + encodeURIComponent(pageNickname) + '/killed-by/' + encodeURIComponent(targetNickname);

    var [res1, res2] = await Promise.all([fetch(url1), fetch(url2)]);
    var data1 = await res1.json();
    var data2 = await res2.json();

    var targetKilledOther = (res1.ok && data1.success) ? data1.totalKills : 0;
    var otherKilledTarget = (res2.ok && data2.success) ? data2.totalDeaths : 0;

    if (targetKilledOther === 0 && otherKilledTarget === 0) {
      showSuccess('result-victim',
        '<div class="result-title">查询结果</div>' +
        '<div class="empty-state">' + escapeHtml(pageNickname) + ' 和 ' + escapeHtml(targetNickname) + ' 没有相互击杀记录</div>'
      );
      return;
    }

    var html = '<div class="result-title">' + escapeHtml(pageNickname) + ' vs ' + escapeHtml(targetNickname) + '</div>';

    html += '<div class="vs-stats">' +
      '<div class="vs-stat">' +
      '<div class="vs-stat-value kills">' + targetKilledOther + '</div>' +
      '<div class="vs-stat-label">' + escapeHtml(pageNickname) + ' 击杀 ' + escapeHtml(targetNickname) + '</div>' +
      '</div>' +
      '<div class="vs-divider">VS</div>' +
      '<div class="vs-stat">' +
      '<div class="vs-stat-value deaths">' + otherKilledTarget + '</div>' +
      '<div class="vs-stat-label">' + escapeHtml(targetNickname) + ' 击杀 ' + escapeHtml(pageNickname) + '</div>' +
      '</div>' +
      '</div>';

    if (targetKilledOther > 0) {
      var targetKillsHtml = data1.killDetails.map(function (kill) {
        return '<div class="kill-item">' +
          '<div class="kill-left">' +
          '<span class="kill-weapon">' + escapeHtml(formatWeapon(kill.weaponId)) + '</span>' +
          '<span class="kill-time">' + formatDate(kill.matchTime) + ' ' + escapeHtml(translateMap(kill.mapName)) + '</span>' +
          '</div>' +
          '<div class="kill-right">' +
          (kill.isHeadshot ? '<span class="kill-headshot">爆头</span>' : '') +
          '<span class="kill-distance">' + formatDistance(kill.distance) + '</span>' +
          '</div>' +
          '</div>';
      }).join('');

      html += '<div class="vs-section">' +
        '<div class="vs-section-title kills">' + escapeHtml(pageNickname) + ' 击杀 ' + escapeHtml(targetNickname) + ' (' + targetKilledOther + '次)</div>' +
        targetKillsHtml +
        '</div>';
    }

    if (otherKilledTarget > 0) {
      var otherKillsHtml = data2.killDetails.map(function (kill) {
        return '<div class="kill-item death-item">' +
          '<div class="kill-left">' +
          '<span class="kill-weapon">' + escapeHtml(formatWeapon(kill.weaponId)) + '</span>' +
          '<span class="kill-time">' + formatDate(kill.matchTime) + ' ' + escapeHtml(translateMap(kill.mapName)) + '</span>' +
          '</div>' +
          '<div class="kill-right">' +
          (kill.isHeadshot ? '<span class="kill-headshot">爆头</span>' : '') +
          '<span class="kill-distance">' + formatDistance(kill.distance) + '</span>' +
          '</div>' +
          '</div>';
      }).join('');

      html += '<div class="vs-section">' +
        '<div class="vs-section-title deaths">' + escapeHtml(targetNickname) + ' 击杀 ' + escapeHtml(pageNickname) + ' (' + otherKilledTarget + '次)</div>' +
        otherKillsHtml +
        '</div>';
    }

    showSuccess('result-victim', '<div style="margin-top: 15px;">' + html + '</div>');
  } catch (error) {
    showError('result-victim', error.message);
  } finally {
    btn.disabled = false;
  }
}

async function queryDeathNote(page) {
  var nickname = document.getElementById('deathnote-nickname').value.trim();

  if (!nickname) {
    alert('请填写昵称');
    return;
  }

  if (page) {
    currentDeathNotePage = page;
  } else {
    currentDeathNotePage = 1;
    currentDeathNoteNickname = nickname;
  }

  var btn = document.getElementById('btn-deathnote');
  btn.disabled = true;
  showLoading('result-deathnote');

  try {
    var url = getApiBase() + '/death-note/nickname/' + encodeURIComponent(nickname) + '/matches?page=' + currentDeathNotePage + '&pageSize=30';
    var response = await fetch(url);
    var data = await response.json();

    if (!response.ok || !data.success) {
      showError('result-deathnote', data.message || data.error || '请求失败');
      return;
    }

    if (data.totalMatches === 0) {
      showSuccess('result-deathnote',
        '<div class="result-title">死亡笔记</div>' +
        '<div class="stat-row">' +
        '<span class="stat-label">玩家</span>' +
        '<span class="stat-value">' + escapeHtml(data.nickname) + '</span>' +
        '</div>' +
        '<div class="stat-row">' +
        '<span class="stat-label">总击杀</span>' +
        '<span class="stat-value">' + data.totalKills + '</span>' +
        '</div>' +
        '<div class="stat-row">' +
        '<span class="stat-label">总死亡</span>' +
        '<span class="stat-value">' + data.totalDeaths + '</span>' +
        '</div>' +
        '<div class="empty-state">暂无比赛记录</div>'
      );
      return;
    }

    var statsHtml =
      '<div class="stat-row">' +
      '<span class="stat-label">玩家</span>' +
      '<span class="stat-value">' + escapeHtml(data.nickname) + '</span>' +
      '</div>' +
      (data.startDate && data.endDate ?
        '<div class="stat-row">' +
        '<span class="stat-label">数据范围</span>' +
        '<span class="stat-value">' + data.startDate + ' ~ ' + data.endDate + '</span>' +
        '</div>' : '') +
      '<div class="stat-row">' +
      '<span class="stat-label">总击杀</span>' +
      '<span class="stat-value" style="color:#2ed573">' + data.totalKills + '</span>' +
      '</div>' +
      '<div class="stat-row">' +
      '<span class="stat-label">总死亡</span>' +
      '<span class="stat-value" style="color:#ff4757">' + data.totalDeaths + '</span>' +
      '</div>' +
      '<div class="stat-row">' +
      '<span class="stat-label">比赛场次</span>' +
      '<span class="stat-value">' + data.totalMatches + '</span>' +
      '</div>';

    allDaysData = data.days;
    availableDates = data.days.map(function (day) { return day.date; });
    allStatsData = data;

    var today = new Date();
    var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    currentViewDate = new Date(todayStr + 'T00:00:00');
    currentCalendarDate = new Date(currentViewDate);

    if (availableDates.indexOf(todayStr) !== -1) {
      selectedDate = todayStr;
      renderCalendar();
      fetchDateData(todayStr);
    } else {
      selectedDate = null;
      renderCalendar();
      renderDays(data.days, '');
    }

    // document.getElementById('toggleCalendarBtn').style.display = 'flex';

    var shareLink = window.location.origin + '/n/' + encodeURIComponent(nickname);
    document.getElementById('shareLinkUrl').textContent = shareLink;
    document.getElementById('shareLink').style.display = 'block';

    renderDays(data.days, '');

    var resultEl = document.getElementById('result-deathnote');
    resultEl.innerHTML = statsHtml + resultEl.innerHTML;
  } catch (error) {
    showError('result-deathnote', error.message);
  } finally {
    btn.disabled = false;
  }
}

function loadDeathNotePage(page) {
  queryDeathNote(page);
}

document.querySelectorAll('.tab').forEach(function (tab) {
  tab.addEventListener('click', function () {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });

    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

document.querySelectorAll('input').forEach(function (input) {
  input.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
      var panel = input.closest('.panel');
      var btn = panel.querySelector('.btn');
      if (btn && !btn.disabled) {
        btn.click();
      }
    }
  });
});

(function init() {
  loadGameDataI18n().then(function() {
    var path = window.location.pathname;
    var match = path.match(/^\/n\/(.+)$/);
    if (match) {
      pageNickname = decodeURIComponent(match[1]);
      document.getElementById('subtitle').innerHTML = '<span>' + escapeHtml(pageNickname) + '</span> 的死亡笔记';
      document.getElementById('deathnote-nickname').value = pageNickname;
      document.getElementById('deathnote-search').style.display = 'none';
      document.getElementById('guideText').textContent = '输入另一位玩家昵称，查看 ' + pageNickname + ' 是否被对方击杀或击杀过对方';
      queryDeathNote();
    }
  });
})();
