/* The Pad - main application script */
(function () {
  const DB_NAME = 'the-pad';
  const DB_VERSION = 1;
  const IDEAS_STORE = 'ideas';
  const VERSIONS_STORE = 'versions';

  const state = {
    db: null,
    ideas: [],
    selectedIdeaId: null,
    currentView: 'list',
    filterTag: null,
    filterDate: null,
    calendarMonth: null,
    calendarYear: null,
    searchQuery: '',
    pendingHighlight: null,
    recognition: null,
    isRecording: false,
  };

  const elements = {};
  let saveTimeout = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    cacheDom();
    bindUI();
    await initDB();
    await loadIdeas();
    initCalendar();
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      elements.voiceNoteBtn.disabled = true;
      elements.voiceNoteBtn.title = 'Speech recognition is unavailable in this browser.';
    }
    render();
    registerServiceWorker();
  }

  function cacheDom() {
    elements.ideasList = document.getElementById('ideas-list');
    elements.toggleView = document.getElementById('toggle-view');
    elements.calendarView = document.getElementById('calendar-view');
    elements.listView = document.getElementById('list-view');
    elements.calendarTitle = document.getElementById('calendar-title');
    elements.calendarDays = document.getElementById('calendar-days');
    elements.prevMonth = document.getElementById('prev-month');
    elements.nextMonth = document.getElementById('next-month');
    elements.addIdea = document.getElementById('add-idea');
    elements.ideaPanel = document.getElementById('idea-panel');
    elements.closePanel = document.getElementById('close-panel');
    elements.ideaForm = document.getElementById('idea-form');
    elements.summaryInput = document.getElementById('idea-summary');
    elements.lastEntryInput = document.getElementById('idea-last-entry');
    elements.nextStepInput = document.getElementById('idea-next-step');
    elements.bodyInput = document.getElementById('idea-body');
    elements.tagInput = document.getElementById('tag-input');
    elements.tagsContainer = document.getElementById('tags-container');
    elements.attachmentsList = document.getElementById('attachments-list');
    elements.voiceNoteBtn = document.getElementById('voice-note-btn');
    elements.photoBtn = document.getElementById('photo-btn');
    elements.linkBtn = document.getElementById('link-btn');
    elements.photoInput = document.getElementById('photo-input');
    elements.closedToggle = document.getElementById('idea-closed');
    elements.searchInput = document.getElementById('search-input');
    elements.searchResults = document.getElementById('search-results');
    elements.searchResultsList = document.getElementById('search-results-list');
    elements.filterNotice = document.getElementById('filter-notice');
    elements.exportBtn = document.getElementById('export-btn');
    elements.importInput = document.getElementById('import-input');
  }

  function bindUI() {
    elements.toggleView.addEventListener('click', toggleView);
    elements.prevMonth.addEventListener('click', () => changeMonth(-1));
    elements.nextMonth.addEventListener('click', () => changeMonth(1));
    elements.addIdea.addEventListener('click', createIdea);
    elements.closePanel.addEventListener('click', closeIdeaPanel);
    elements.searchInput.addEventListener('input', handleSearch);
    elements.tagInput.addEventListener('keydown', handleTagInput);
    elements.voiceNoteBtn.addEventListener('click', handleVoiceNote);
    elements.photoBtn.addEventListener('click', () => elements.photoInput.click());
    elements.photoInput.addEventListener('change', handlePhoto);
    elements.linkBtn.addEventListener('click', handleLink);
    elements.closedToggle.addEventListener('change', handleClosedToggle);
    elements.exportBtn.addEventListener('click', exportData);
    elements.importInput.addEventListener('change', importData);

    elements.summaryInput.addEventListener('input', () => updateIdeaField('summary', elements.summaryInput.value));
    elements.nextStepInput.addEventListener('input', () => updateIdeaField('nextStep', elements.nextStepInput.value));
    elements.bodyInput.addEventListener('input', () => {
      updateIdeaField('body', elements.bodyInput.value);
      elements.lastEntryInput.value = computeLastEntry(elements.bodyInput.value);
    });

    elements.ideaPanel.addEventListener('click', (event) => {
      if (event.target === elements.ideaPanel) {
        closeIdeaPanel();
      }
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && elements.ideaPanel.classList.contains('active')) {
        closeIdeaPanel();
      }
    });
  }

  function toggleView() {
    state.currentView = state.currentView === 'list' ? 'calendar' : 'list';
    const showCalendar = state.currentView === 'calendar';
    elements.calendarView.hidden = !showCalendar;
    elements.listView.hidden = showCalendar;
    elements.toggleView.textContent = showCalendar ? 'Show List' : 'Show Calendar';
    elements.toggleView.setAttribute('aria-pressed', showCalendar.toString());
    render();
  }

  function initCalendar() {
    const today = new Date();
    state.calendarMonth = today.getMonth();
    state.calendarYear = today.getFullYear();
  }

  function changeMonth(offset) {
    state.calendarMonth += offset;
    if (state.calendarMonth < 0) {
      state.calendarMonth = 11;
      state.calendarYear -= 1;
    } else if (state.calendarMonth > 11) {
      state.calendarMonth = 0;
      state.calendarYear += 1;
    }
    renderCalendar();
  }

  function openIdeaPanel() {
    elements.ideaPanel.classList.add('active');
    elements.ideaPanel.setAttribute('aria-hidden', 'false');
  }

  function closeIdeaPanel() {
    state.selectedIdeaId = null;
    elements.ideaPanel.classList.remove('active');
    elements.ideaPanel.setAttribute('aria-hidden', 'true');
    elements.voiceNoteBtn.textContent = 'Voice note';
    state.isRecording = false;
    if (state.recognition) {
      state.recognition.stop();
    }
  }

  async function initDB() {
    state.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(IDEAS_STORE)) {
          db.createObjectStore(IDEAS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(VERSIONS_STORE)) {
          const versionsStore = db.createObjectStore(VERSIONS_STORE, { keyPath: 'id', autoIncrement: true });
          versionsStore.createIndex('ideaId', 'ideaId', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function loadIdeas() {
    const tx = state.db.transaction([IDEAS_STORE], 'readonly');
    const store = tx.objectStore(IDEAS_STORE);
    state.ideas = await requestPromise(store.getAll());
  }

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function render() {
    renderFiltersNotice();
    if (state.currentView === 'list') {
      renderIdeasList();
    } else {
      renderCalendar();
    }
    handleSearch();
  }

  function renderFiltersNotice() {
    const notices = [];
    if (state.filterTag) {
      notices.push(`Filtered by tag ${state.filterTag}`);
    }
    if (state.filterDate) {
      notices.push(`Showing ideas from ${formatDisplayDate(state.filterDate)}`);
    }
    elements.filterNotice.innerHTML = '';
    if (!notices.length) return;
    const text = document.createElement('span');
    text.textContent = notices.join(' · ');
    elements.filterNotice.appendChild(text);
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'clear-filters';
    clear.textContent = 'Clear filters';
    clear.addEventListener('click', clearFilters);
    elements.filterNotice.appendChild(clear);
  }

  function clearFilters() {
    state.filterTag = null;
    state.filterDate = null;
    render();
  }

  function getFilteredIdeas() {
    let ideas = [...state.ideas];
    if (state.filterTag) {
      ideas = ideas.filter((idea) => (idea.tags || []).includes(state.filterTag));
    }
    if (state.filterDate) {
      ideas = ideas.filter((idea) => {
        const date = formatISODate(new Date(idea.updated || idea.created));
        return date === state.filterDate;
      });
    }
    ideas.sort((a, b) => (b.updated || b.created) - (a.updated || a.created));
    return ideas;
  }

  function renderIdeasList() {
    const ideas = getFilteredIdeas();
    elements.ideasList.innerHTML = '';
    if (!ideas.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No ideas yet. Tap “+” to capture a thought!';
      empty.className = 'idea-empty';
      elements.ideasList.appendChild(empty);
      return;
    }
    ideas.forEach((idea) => {
      const item = document.createElement('li');
      item.className = 'idea-item';
      if (idea.closed) {
        item.classList.add('closed');
      }
      item.tabIndex = 0;
      item.dataset.id = idea.id;

      const content = document.createElement('div');
      const title = document.createElement('p');
      title.className = 'idea-title';
      title.textContent = idea.summary?.trim() || 'Untitled idea';
      content.appendChild(title);

      const tagsWrap = document.createElement('div');
      (idea.tags || []).forEach((tag) => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = tag;
        chip.addEventListener('click', (event) => {
          event.stopPropagation();
          applyTagFilter(tag);
        });
        chip.tabIndex = 0;
        chip.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            applyTagFilter(tag);
          }
        });
        tagsWrap.appendChild(chip);
      });
      if (tagsWrap.childElementCount) {
        content.appendChild(tagsWrap);
      }

      const date = document.createElement('span');
      date.className = 'idea-date';
      date.textContent = formatDate(idea.updated || idea.created);

      item.appendChild(content);
      item.appendChild(date);

      item.addEventListener('click', () => openIdea(idea.id));
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openIdea(idea.id);
        }
      });

      elements.ideasList.appendChild(item);
    });
  }

  function renderCalendar() {
    const monthStart = new Date(state.calendarYear, state.calendarMonth, 1);
    elements.calendarTitle.textContent = monthStart.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });

    const firstDay = monthStart.getDay();
    const daysInMonth = new Date(state.calendarYear, state.calendarMonth + 1, 0).getDate();
    const daysFragment = document.createDocumentFragment();

    const ideasByDate = new Map();
    state.ideas.forEach((idea) => {
      const iso = formatISODate(new Date(idea.updated || idea.created));
      const count = ideasByDate.get(iso) || 0;
      ideasByDate.set(iso, count + 1);
    });

    for (let i = 0; i < firstDay; i += 1) {
      const filler = document.createElement('div');
      filler.className = 'calendar-day';
      filler.setAttribute('aria-hidden', 'true');
      daysFragment.appendChild(filler);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(state.calendarYear, state.calendarMonth, day);
      const iso = formatISODate(date);
      const dayEl = document.createElement('div');
      dayEl.className = 'calendar-day';
      dayEl.tabIndex = 0;

      const number = document.createElement('span');
      number.className = 'day-number';
      number.textContent = day;
      dayEl.appendChild(number);

      const count = ideasByDate.get(iso) || 0;
      if (count > 0) {
        dayEl.classList.add('has-idea');
        const indicator = document.createElement('span');
        indicator.className = 'idea-count';
        indicator.textContent = `${count} idea${count > 1 ? 's' : ''}`;
        dayEl.appendChild(indicator);
      }

      dayEl.addEventListener('click', () => {
        state.filterDate = iso;
        state.currentView = 'list';
        elements.calendarView.hidden = true;
        elements.listView.hidden = false;
        elements.toggleView.textContent = 'Show Calendar';
        elements.toggleView.setAttribute('aria-pressed', 'false');
        render();
      });

      dayEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          dayEl.click();
        }
      });

      daysFragment.appendChild(dayEl);
    }

    elements.calendarDays.innerHTML = '';
    elements.calendarDays.appendChild(daysFragment);
  }

  async function openIdea(id) {
    const idea = state.ideas.find((i) => i.id === id);
    if (!idea) return;
    state.selectedIdeaId = id;
    elements.summaryInput.value = idea.summary || '';
    elements.nextStepInput.value = idea.nextStep || '';
    elements.bodyInput.value = idea.body || '';
    elements.lastEntryInput.value = computeLastEntry(idea.body || '');
    elements.closedToggle.checked = Boolean(idea.closed);
    renderTags(idea);
    renderAttachments(idea);
    openIdeaPanel();
    elements.summaryInput.focus();

    if (state.pendingHighlight) {
      const idx = idea.body?.toLowerCase().indexOf(state.pendingHighlight.toLowerCase());
      if (idx >= 0) {
        elements.bodyInput.focus();
        elements.bodyInput.setSelectionRange(idx, idx + state.pendingHighlight.length);
      }
      state.pendingHighlight = null;
    }
  }

  function updateIdeaField(field, value) {
    if (!state.selectedIdeaId) return;
    const idea = state.ideas.find((i) => i.id === state.selectedIdeaId);
    if (!idea) return;
    idea[field] = value;
    idea.updated = Date.now();
    if (field === 'body') {
      idea.lastEntry = computeLastEntry(value);
    }
    scheduleSave(idea);
    render();
  }

  function scheduleSave(idea) {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
      persistIdea(idea);
      saveTimeout = null;
    }, 350);
  }

  async function persistIdea(idea) {
    const tx = state.db.transaction([IDEAS_STORE], 'readwrite');
    const store = tx.objectStore(IDEAS_STORE);
    await requestPromise(store.put(idea));
    await transactionDone(tx);
    await saveVersionSnapshot(idea);
    await loadIdeas();
    render();
  }

  async function saveVersionSnapshot(idea) {
    const snippet = (idea.body || '').slice(-500);
    const version = {
      ideaId: idea.id,
      timestamp: Date.now(),
      snippet,
    };
    const tx = state.db.transaction([VERSIONS_STORE], 'readwrite');
    const store = tx.objectStore(VERSIONS_STORE);
    await requestPromise(store.add(version));
    await transactionDone(tx);
  }

  async function createIdea() {
    const now = Date.now();
    const id = crypto.randomUUID();
    const idea = {
      id,
      created: now,
      updated: now,
      summary: '',
      nextStep: '',
      body: '',
      lastEntry: '',
      tags: [],
      attachments: [],
      closed: false,
    };
    const tx = state.db.transaction([IDEAS_STORE], 'readwrite');
    const store = tx.objectStore(IDEAS_STORE);
    await requestPromise(store.add(idea));
    await transactionDone(tx);
    await saveVersionSnapshot(idea);
    state.ideas.push(idea);
    render();
    openIdea(id);
  }

  function renderTags(idea) {
    elements.tagsContainer.innerHTML = '';
    (idea.tags || []).forEach((tag) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      const text = document.createElement('span');
      text.textContent = tag;
      chip.appendChild(text);

      chip.addEventListener('click', () => applyTagFilter(tag));
      chip.tabIndex = 0;
      chip.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          applyTagFilter(tag);
        }
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove tag ${tag}`);
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        removeTag(tag);
      });
      chip.appendChild(remove);
      elements.tagsContainer.appendChild(chip);
    });
  }

  function handleTagInput(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const raw = elements.tagInput.value.trim();
      if (!raw) return;
      const tag = raw.startsWith('#') ? raw : `#${raw}`;
      elements.tagInput.value = '';
      addTag(tag);
    }
  }

  function addTag(tag) {
    if (!state.selectedIdeaId) return;
    const idea = state.ideas.find((i) => i.id === state.selectedIdeaId);
    if (!idea || idea.tags.includes(tag)) return;
    idea.tags.push(tag);
    idea.updated = Date.now();
    renderTags(idea);
    scheduleSave(idea);
    render();
  }

  function removeTag(tag) {
    if (!state.selectedIdeaId) return;
    const idea = state.ideas.find((i) => i.id === state.selectedIdeaId);
    if (!idea) return;
    idea.tags = idea.tags.filter((t) => t !== tag);
    idea.updated = Date.now();
    renderTags(idea);
    scheduleSave(idea);
    render();
  }

  function applyTagFilter(tag) {
    state.filterTag = tag;
    state.currentView = 'list';
    elements.calendarView.hidden = true;
    elements.listView.hidden = false;
    elements.toggleView.textContent = 'Show Calendar';
    elements.toggleView.setAttribute('aria-pressed', 'false');
    render();
  }

  function handleClosedToggle() {
    updateIdeaField('closed', elements.closedToggle.checked);
  }

  function handleSearch() {
    state.searchQuery = elements.searchInput.value.trim();
    const query = state.searchQuery.toLowerCase();
    if (!query) {
      elements.searchResults.hidden = true;
      elements.searchResultsList.innerHTML = '';
      return;
    }
    const matches = state.ideas.filter((idea) => {
      const summary = idea.summary || '';
      const body = idea.body || '';
      return summary.toLowerCase().includes(query) || body.toLowerCase().includes(query);
    });

    elements.searchResults.hidden = false;
    elements.searchResultsList.innerHTML = '';
    if (!matches.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No matches found.';
      elements.searchResultsList.appendChild(empty);
      return;
    }

    matches.forEach((idea) => {
      const item = document.createElement('li');
      item.textContent = idea.summary?.trim() || 'Untitled idea';
      item.tabIndex = 0;
      item.addEventListener('click', () => {
        state.pendingHighlight = query;
        openIdea(idea.id);
      });
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          item.click();
        }
      });
      elements.searchResultsList.appendChild(item);
    });
  }

  function computeLastEntry(text) {
    if (!text) return '';
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.length ? lines[lines.length - 1] : '';
  }

  function renderAttachments(idea) {
    elements.attachmentsList.innerHTML = '';
    (idea.attachments || []).forEach((attachment) => {
      const item = document.createElement('li');
      item.className = 'attachment-item';
      item.dataset.id = attachment.id;

      if (attachment.type === 'image') {
        const img = document.createElement('img');
        img.src = attachment.thumbnail;
        img.alt = attachment.name;
        img.className = 'attachment-thumbnail';
        item.appendChild(img);
      } else if (attachment.type === 'voice') {
        const icon = document.createElement('span');
        icon.textContent = '🎤';
        item.appendChild(icon);
      } else if (attachment.type === 'link') {
        const icon = document.createElement('span');
        icon.textContent = '🔗';
        item.appendChild(icon);
      }

      const info = document.createElement('div');
      info.style.flex = '1';
      const title = document.createElement('strong');
      title.textContent = attachment.title || attachment.name || attachment.url || 'Attachment';
      info.appendChild(title);
      if (attachment.type === 'voice' && attachment.transcript) {
        const transcript = document.createElement('p');
        transcript.textContent = attachment.transcript;
        transcript.style.margin = '0.25rem 0 0 0';
        transcript.style.fontSize = '0.9rem';
        info.appendChild(transcript);
      }
      if (attachment.type === 'link' && attachment.url) {
        const link = document.createElement('a');
        link.href = attachment.url;
        link.textContent = attachment.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.style.display = 'block';
        link.style.fontSize = '0.85rem';
        info.appendChild(link);
      }
      item.appendChild(info);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove attachment');
      remove.addEventListener('click', () => removeAttachment(attachment.id));
      item.appendChild(remove);

      elements.attachmentsList.appendChild(item);
    });
  }

  function ensureCurrentIdea() {
    if (!state.selectedIdeaId) return null;
    return state.ideas.find((i) => i.id === state.selectedIdeaId) || null;
  }

  function handleVoiceNote() {
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }
    if (!state.recognition) {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      state.recognition = new Recognition();
      state.recognition.lang = navigator.language || 'en-US';
      state.recognition.interimResults = false;
      state.recognition.maxAlternatives = 1;
      state.recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((result) => result[0].transcript)
          .join(' ');
        if (transcript) {
          addVoiceAttachment(transcript);
        }
      };
      state.recognition.onerror = () => {
        state.isRecording = false;
        elements.voiceNoteBtn.textContent = 'Voice note';
      };
      state.recognition.onend = () => {
        state.isRecording = false;
        elements.voiceNoteBtn.textContent = 'Voice note';
      };
    }

    if (!state.isRecording) {
      state.isRecording = true;
      elements.voiceNoteBtn.textContent = 'Stop voice note';
      try {
        state.recognition.start();
      } catch (error) {
        console.error(error);
        state.isRecording = false;
        elements.voiceNoteBtn.textContent = 'Voice note';
      }
    } else {
      state.isRecording = false;
      elements.voiceNoteBtn.textContent = 'Voice note';
      try {
        state.recognition.stop();
      } catch (error) {
        console.error(error);
      }
    }
  }

  function addVoiceAttachment(transcript) {
    const idea = ensureCurrentIdea();
    if (!idea) return;
    const attachment = {
      id: crypto.randomUUID(),
      type: 'voice',
      transcript,
      title: 'Voice note',
      created: Date.now(),
    };
    idea.attachments.push(attachment);
    idea.updated = Date.now();
    renderAttachments(idea);
    scheduleSave(idea);
  }

  function handlePhoto(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const idea = ensureCurrentIdea();
      if (!idea) return;
      const attachment = {
        id: crypto.randomUUID(),
        type: 'image',
        name: file.name,
        created: Date.now(),
        thumbnail: reader.result,
      };
      idea.attachments.push(attachment);
      idea.updated = Date.now();
      renderAttachments(idea);
      scheduleSave(idea);
    };
    reader.readAsDataURL(file);
    elements.photoInput.value = '';
  }

  function handleLink() {
    const url = prompt('Enter the URL to attach:');
    if (!url) return;
    try {
      const parsed = new URL(url, window.location.origin);
      const idea = ensureCurrentIdea();
      if (!idea) return;
      const attachment = {
        id: crypto.randomUUID(),
        type: 'link',
        url: parsed.href,
        title: parsed.hostname,
        created: Date.now(),
      };
      idea.attachments.push(attachment);
      idea.updated = Date.now();
      renderAttachments(idea);
      scheduleSave(idea);
    } catch (error) {
      alert('Please enter a valid URL.');
    }
  }

  function removeAttachment(id) {
    const idea = ensureCurrentIdea();
    if (!idea) return;
    idea.attachments = idea.attachments.filter((attachment) => attachment.id !== id);
    idea.updated = Date.now();
    renderAttachments(idea);
    scheduleSave(idea);
  }

  function formatDate(timestamp) {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function formatISODate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatDisplayDate(iso) {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  async function exportData() {
    const txIdeas = state.db.transaction([IDEAS_STORE], 'readonly');
    const ideasStore = txIdeas.objectStore(IDEAS_STORE);
    const ideas = await requestPromise(ideasStore.getAll());

    const txVersions = state.db.transaction([VERSIONS_STORE], 'readonly');
    const versionsStore = txVersions.objectStore(VERSIONS_STORE);
    const allVersions = await requestPromise(versionsStore.getAll());

    const versionsByIdea = ideas.reduce((acc, idea) => {
      acc[idea.id] = allVersions.filter((version) => version.ideaId === idea.id);
      return acc;
    }, {});

    const payload = {
      exportedAt: new Date().toISOString(),
      ideas,
      versions: versionsByIdea,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `the-pad-export-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.ideas) {
        throw new Error('Invalid file');
      }
      await mergeIdeas(data.ideas);
      if (data.versions) {
        await mergeVersions(data.versions);
      }
      await loadIdeas();
      render();
      alert('Import complete.');
    } catch (error) {
      console.error(error);
      alert('Import failed. Please check the file.');
    } finally {
      elements.importInput.value = '';
    }
  }

  async function mergeIdeas(ideas) {
    const tx = state.db.transaction([IDEAS_STORE], 'readwrite');
    const store = tx.objectStore(IDEAS_STORE);
    for (const idea of ideas) {
      const existing = await requestPromise(store.get(idea.id));
      if (existing) {
        const merged = { ...existing, ...idea, id: idea.id };
        await requestPromise(store.put(merged));
      } else {
        await requestPromise(store.add(idea));
      }
    }
    await transactionDone(tx);
  }

  async function mergeVersions(versionsByIdea) {
    const tx = state.db.transaction([VERSIONS_STORE], 'readwrite');
    const store = tx.objectStore(VERSIONS_STORE);
    const index = store.index('ideaId');
    for (const [ideaId, versions] of Object.entries(versionsByIdea)) {
      const existing = await requestPromise(index.getAll(IDBKeyRange.only(ideaId)));
      for (const version of versions) {
        const duplicate = existing.some((item) => item.timestamp === version.timestamp && item.snippet === version.snippet);
        if (!duplicate) {
          const record = { ideaId, timestamp: version.timestamp, snippet: version.snippet };
          await requestPromise(store.add(record));
          existing.push(record);
        }
      }
    }
    await transactionDone(tx);
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js').catch((error) => {
          console.error('Service worker registration failed:', error);
        });
      });
    }
  }
})();
