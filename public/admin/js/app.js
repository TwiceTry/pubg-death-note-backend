const API_BASE = '/api/v1/pubg';

let activeTaskId = null;

// ==================== Token 管理 ====================

function getAdminToken() {
  return document.getElementById('adminToken').value.trim();
}

function saveToken(token) {
  localStorage.setItem('adminToken', token);
}

function loadToken() {
  const token = localStorage.getItem('adminToken');
  if (token) {
    document.getElementById('adminToken').value = token;
  }
}

function toggleTokenVisibility() {
  const input = document.getElementById('adminToken');
  input.type = input.type === 'password' ? 'text' : 'password';
}

async function apiFetch(url, options = {}) {
  const token = getAdminToken();
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': token,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    throw new Error('鉴权失败，请检查 Admin Token');
  }

  return res;
}

loadToken();

document.getElementById('adminToken').addEventListener('input', (e) => {
  saveToken(e.target.value.trim());
});

// ==================== Tab 切换 ====================

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab(item.dataset.tab);
  });
});

function switchTab(tab) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

  document.querySelector(`.nav-item[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`panel-${tab}`).classList.add('active');

  const titles = { tasks: '任务管理', sync: '数据同步', deathnote: '死亡笔记' };
  document.getElementById('pageTitle').textContent = titles[tab] || '';
}

// ==================== 工具函数 ====================

function showResult(containerId, message, type = 'info') {
  const el = document.getElementById(containerId);
  el.className = `result-box ${type}`;
  el.textContent = message;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('zh-CN', { hour12: false });
}

// ==================== 任务管理 ====================

let taskPage = 1;
const taskLimit = 20;

async function loadTaskList() {
  try {
    const res = await apiFetch(`/tasks/list?page=${taskPage}&limit=${taskLimit}`);
    const data = await res.json();
    const container = document.getElementById('taskList');

    if (!data.success || !data.tasks || data.tasks.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无任务记录</div>';
      return;
    }

    let html = '';
    for (const task of data.tasks) {
      html += `
        <div class="task-item">
          <div class="task-info">
            <div class="task-type">${task.type}</div>
            <div class="task-time">创建时间: ${formatDate(task.createdAt)} | 进度: ${task.progress}%</div>
          </div>
          <span class="task-status ${task.status}">${task.status}</span>
        </div>
      `;
    }

    if (data.totalPages > 1) {
      html += `<div class="pagination">
        <button class="btn btn-secondary" ${taskPage <= 1 ? 'disabled' : ''} onclick="changeTaskPage(-1)">上一页</button>
        <span class="page-info">${data.page} / ${data.totalPages} (共 ${data.total} 条)</span>
        <button class="btn btn-secondary" ${taskPage >= data.totalPages ? 'disabled' : ''} onclick="changeTaskPage(1)">下一页</button>
      </div>`;
    }

    container.innerHTML = html;
  } catch (err) {
    showResult('taskList', '加载失败: ' + err.message, 'error');
  }
}

function changeTaskPage(delta) {
  taskPage += delta;
  loadTaskList();
}

// ==================== 数据同步 ====================

async function syncLocalMatches() {
  const btn = document.getElementById('btnSync');
  const progressContainer = document.getElementById('syncProgress');
  const progressFill = document.getElementById('syncProgressFill');
  const progressText = document.getElementById('syncProgressText');

  btn.disabled = true;
  progressContainer.style.display = 'flex';
  progressFill.style.width = '0%';
  progressText.textContent = '0%';
  document.getElementById('syncResult').className = 'result-box';

  try {
    const res = await apiFetch('/tasks/sync-local-matches', { method: 'POST' });
    const data = await res.json();

    if (!data.success) {
      showResult('syncResult', '创建任务失败: ' + (data.message || '未知错误'), 'error');
      btn.disabled = false;
      return;
    }

    const taskId = data.taskId;
    showResult('syncResult', '任务已创建，正在同步...', 'info');

    const pollInterval = setInterval(async () => {
      try {
        const statusRes = await apiFetch(`/tasks/${taskId}`);
        const statusData = await statusRes.json();

        if (!statusData.success || !statusData.task) {
          clearInterval(pollInterval);
          btn.disabled = false;
          return;
        }

        const task = statusData.task;
        progressFill.style.width = `${task.progress}%`;
        progressText.textContent = `${task.progress}%`;

        if (task.status === 'completed') {
          clearInterval(pollInterval);
          btn.disabled = false;
          const result = task.result || {};
          showResult('syncResult',
            `同步完成！比赛数: ${result.totalMatches}, 新增: ${result.newMatches}, 更新: ${result.updatedMatches}, UserMatch: ${result.newUserMatches}, KillEvent: ${result.newKillEvents}`,
            'success');
          loadTaskList();
        } else if (task.status === 'failed') {
          clearInterval(pollInterval);
          btn.disabled = false;
          showResult('syncResult', '同步失败: ' + (task.result?.message || '未知错误'), 'error');
        } else if (task.status === 'cancelled') {
          clearInterval(pollInterval);
          btn.disabled = false;
          showResult('syncResult', '任务已取消', 'error');
        }
      } catch (err) {
        clearInterval(pollInterval);
        btn.disabled = false;
        showResult('syncResult', '查询状态失败: ' + err.message, 'error');
      }
    }, 1000);
  } catch (err) {
    btn.disabled = false;
    showResult('syncResult', '请求失败: ' + err.message, 'error');
  }
}

async function reparseMatch() {
  const matchId = document.getElementById('reparseMatchId').value.trim();
  if (!matchId) {
    showResult('reparseResult', '请输入 Match ID', 'error');
    return;
  }

  const btn = document.getElementById('btnReparseMatch');
  btn.disabled = true;
  showResult('reparseResult', '正在创建重解析任务...', 'info');

  try {
    const res = await apiFetch(`/tasks/telemetry/reparse/match/${matchId}`, { method: 'POST' });
    const data = await res.json();

    if (!data.success) {
      showResult('reparseResult', '创建任务失败', 'error');
      btn.disabled = false;
      return;
    }

    const taskId = data.taskId;
    showResult('reparseResult', '任务已创建，正在处理...', 'info');

    const pollInterval = setInterval(async () => {
      try {
        const statusRes = await apiFetch(`/tasks/${taskId}`);
        const statusData = await statusRes.json();

        if (!statusData.success || !statusData.task) {
          clearInterval(pollInterval);
          btn.disabled = false;
          return;
        }

        const task = statusData.task;
        if (task.status === 'completed') {
          clearInterval(pollInterval);
          btn.disabled = false;
          showResult('reparseResult', `重解析完成: ${task.result?.message || '成功'}`, 'success');
          loadTaskList();
        } else if (task.status === 'failed') {
          clearInterval(pollInterval);
          btn.disabled = false;
          showResult('reparseResult', '重解析失败: ' + (task.result?.message || '未知错误'), 'error');
        } else if (task.status === 'cancelled') {
          clearInterval(pollInterval);
          btn.disabled = false;
          showResult('reparseResult', '任务已取消', 'error');
        }
      } catch (err) {
        clearInterval(pollInterval);
        btn.disabled = false;
        showResult('reparseResult', '查询状态失败: ' + err.message, 'error');
      }
    }, 1000);
  } catch (err) {
    btn.disabled = false;
    showResult('reparseResult', '请求失败: ' + err.message, 'error');
  }
}

async function reparseAll() {
  const btn = document.getElementById('btnReparseAll');
  btn.disabled = true;
  showResult('reparseResult', '正在创建全局重解析任务...', 'info');

  try {
    const res = await apiFetch('/tasks/reparse/all', { method: 'POST' });
    const data = await res.json();

    if (!data.success) {
      showResult('reparseResult', '创建任务失败', 'error');
      btn.disabled = false;
      return;
    }

    const taskId = data.taskId;
    showResult('reparseResult', '任务已创建，正在处理...', 'info');

    const pollInterval = setInterval(async () => {
      try {
        const statusRes = await apiFetch(`/tasks/${taskId}`);
        const statusData = await statusRes.json();

        if (!statusData.success || !statusData.task) {
          clearInterval(pollInterval);
          btn.disabled = false;
          return;
        }

        const task = statusData.task;
        if (task.status === 'completed') {
          clearInterval(pollInterval);
          btn.disabled = false;
          showResult('reparseResult', `重解析完成: ${task.result?.message || '成功'}`, 'success');
          loadTaskList();
        } else if (task.status === 'failed') {
          clearInterval(pollInterval);
          btn.disabled = false;
          showResult('reparseResult', '重解析失败: ' + (task.result?.message || '未知错误'), 'error');
        }
      } catch (err) {
        clearInterval(pollInterval);
        btn.disabled = false;
        showResult('reparseResult', '查询状态失败: ' + err.message, 'error');
      }
    }, 1000);
  } catch (err) {
    btn.disabled = false;
    showResult('reparseResult', '请求失败: ' + err.message, 'error');
  }
}

// ==================== 死亡笔记 ====================

async function generateDeathNote() {
  const nickname = document.getElementById('deathnoteNickname').value.trim();
  if (!nickname) {
    showResult('deathnoteResult', '请输入玩家昵称', 'error');
    return;
  }

  const btn = document.getElementById('btnGenerate');
  btn.disabled = true;
  showResult('deathnoteResult', '正在创建生成任务...', 'info');

  try {
    const res = await apiFetch(`/tasks/death-note/generate/${encodeURIComponent(nickname)}`, { method: 'POST' });

    if (res.status === 409) {
      showResult('deathnoteResult', '该用户已有任务正在运行，请等待完成后再试', 'error');
      btn.disabled = false;
      return;
    }

    const data = await res.json();

    if (!data.success) {
      showResult('deathnoteResult', '创建任务失败', 'error');
      btn.disabled = false;
      return;
    }

    const taskId = data.taskId;
    activeTaskId = taskId;
    showResult('deathnoteResult', '任务已创建，正在生成...', 'info');

    const pollInterval = setInterval(async () => {
      try {
        const statusRes = await apiFetch(`/tasks/${taskId}`);
        const statusData = await statusRes.json();

        if (!statusData.success || !statusData.task) {
          clearInterval(pollInterval);
          btn.disabled = false;
          return;
        }

        const task = statusData.task;
        if (activeTaskId !== taskId) {
          clearInterval(pollInterval);
          return;
        }

        if (task.status === 'completed') {
          clearInterval(pollInterval);
          btn.disabled = false;
          const result = task.result || {};
          showResult('deathnoteResult',
            `生成完成！用户: ${result.nickname}, 比赛数: ${result.totalMatches}, 处理: ${result.processedMatches}`,
            'success');
          loadTaskList();
        } else if (task.status === 'failed') {
          clearInterval(pollInterval);
          btn.disabled = false;
          showResult('deathnoteResult', '生成失败: ' + (task.result?.message || '未知错误'), 'error');
        } else if (task.status === 'cancelled') {
          clearInterval(pollInterval);
          btn.disabled = false;
        }
      } catch (err) {
        clearInterval(pollInterval);
        btn.disabled = false;
        showResult('deathnoteResult', '查询状态失败: ' + err.message, 'error');
      }
    }, 1000);
  } catch (err) {
    btn.disabled = false;
    showResult('deathnoteResult', '请求失败: ' + err.message, 'error');
  }
}

async function forceGenerateDeathNote() {
  const nickname = document.getElementById('deathnoteNickname').value.trim();
  if (!nickname) {
    showResult('deathnoteResult', '请输入玩家昵称', 'error');
    return;
  }

  if (!confirm('确定要强制重新生成吗？这将清除已有进度重新开始。')) {
    return;
  }

  const btn = document.getElementById('btnForceGenerate');
  btn.disabled = true;
  showResult('deathnoteResult', '正在创建强制生成任务...', 'info');

  try {
    const res = await apiFetch(`/tasks/death-note/force-generate/${encodeURIComponent(nickname)}`, { method: 'POST' });
    const data = await res.json();

    if (!data.success) {
      showResult('deathnoteResult', '创建任务失败', 'error');
      btn.disabled = false;
      return;
    }

    const taskId = data.taskId;
    activeTaskId = taskId;
    showResult('deathnoteResult', '任务已创建，正在生成...', 'info');

    const pollInterval = setInterval(async () => {
      try {
        const statusRes = await apiFetch(`/tasks/${taskId}`);
        const statusData = await statusRes.json();

        if (!statusData.success || !statusData.task) {
          clearInterval(pollInterval);
          btn.disabled = false;
          return;
        }

        const task = statusData.task;
        if (activeTaskId !== taskId) {
          clearInterval(pollInterval);
          return;
        }

        if (task.status === 'completed') {
          clearInterval(pollInterval);
          btn.disabled = false;
          const result = task.result || {};
          showResult('deathnoteResult',
            `强制生成完成！用户: ${result.nickname}, 比赛数: ${result.totalMatches}, 处理: ${result.processedMatches}`,
            'success');
          loadTaskList();
        } else if (task.status === 'failed') {
          clearInterval(pollInterval);
          btn.disabled = false;
          showResult('deathnoteResult', '生成失败: ' + (task.result?.message || '未知错误'), 'error');
        }
      } catch (err) {
        clearInterval(pollInterval);
        btn.disabled = false;
        showResult('deathnoteResult', '查询状态失败: ' + err.message, 'error');
      }
    }, 1000);
  } catch (err) {
    btn.disabled = false;
    showResult('deathnoteResult', '请求失败: ' + err.message, 'error');
  }
}

async function loadDeathNoteList() {
  try {
    const res = await apiFetch('/tasks/death-note/list');
    const data = await res.json();
    const container = document.getElementById('deathNoteList');

    if (!data.success || !data.data || data.data.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无死亡笔记记录</div>';
      return;
    }

    let html = `
      <table class="death-note-table">
        <thead>
          <tr>
            <th>昵称</th>
            <th>生成状态</th>
            <th>最近任务</th>
            <th>进度</th>
            <th>每日增量</th>
            <th>请求时间</th>
            <th>完成时间</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const note of data.data) {
      const statusClass = note.isGenerated ? 'completed' : 'pending';
      const statusText = note.isGenerated ? '已生成' : '生成中';
      const incrementalText = note.dailyIncrementalEnabled ? '启用' : '禁用';
      const incrementalClass = note.dailyIncrementalEnabled ? 'enabled' : 'disabled';

      html += `
        <tr>
          <td class="nickname-cell">${note.nickname}</td>
          <td><span class="status-badge ${statusClass}">${statusText}</span></td>
          <td>${note.latestTaskType || '-'}</td>
          <td>
            <div class="mini-progress">
              <div class="mini-progress-bar" style="width: ${note.latestTaskProgress}%"></div>
              <span>${note.latestTaskProgress}%</span>
            </div>
          </td>
          <td><span class="incremental-badge ${incrementalClass}">${incrementalText}</span></td>
          <td>${formatDate(note.requestTime)}</td>
          <td>${note.actualEndTime ? formatDate(note.actualEndTime) : '-'}</td>
        </tr>
      `;
    }

    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (err) {
    showResult('deathNoteList', '加载失败: ' + err.message, 'error');
  }
}

// ==================== 初始化 ====================

loadTaskList();
