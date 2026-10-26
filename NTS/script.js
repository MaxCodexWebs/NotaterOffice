document.addEventListener('DOMContentLoaded', () => {
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regristrations => {
    for (let regristration of regristrations) {
      regristration.unregister();
      console.log('Service Worker gelöscht:', regristration);
    }
  });
}
if ('caches' in window) {
  caches.keys().then(names => {
    for (let name of names) caches.delete(name)
  });
}
// ==========================================
// 1. SICHERHEIT & DATENBANK-SETUP
// ==========================================

// Sicherheitsfunktion gegen XSS (Muss ganz oben stehen)
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

// Wir erhöhen die Version hier auf 2! 
// Das zwingt den Browser, die Datenbankstruktur neu und fehlerfrei aufzubauen.
const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('NotaterSkriverDB', 2); // <- Version 2
    
    request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('documents')) {
            db.createObjectStore('documents', { keyPath: 'id' });
        }
    };
    
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => {
        console.error("IndexedDB Fehler:", e.target.error);
        reject(e.target.error);
    };
});
/* ── DASHBOARD── */
const dashboard = document.getElementById('ntsDashboard');
const mainApp = document.getElementById('mainApp');
const newDocBtn = document.getElementById('newDocBtn');
const backToDashBtn = document.getElementById('backToDashBtn');
const recentDocsList = document.getElementById('recentDocsList');
const docTitleInput = document.getElementById('docTitle');
function aktualisiereUhrzeit() {
  const jetzt = new Date();
  const zeitString = jetzt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('uhrzeit').textContent = zeitString + " Uhr";
}

// Uhrzeit sofort laden und jede Sekunde aktualisieren
aktualisiereUhrzeit();
setInterval(aktualisiereUhrzeit, 1000);
// ==========================================
// 4. DATENBANK-LESEFUNKTIONEN
// ==========================================
async function getAllDocumentsFromDB() {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('documents', 'readonly');
        const store = tx.objectStore('documents');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getDocumentFromDB(id) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('documents', 'readonly');
        const store = tx.objectStore('documents');
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function deleteDocumentFromDB(id) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('documents', 'readwrite');
        const store = tx.objectStore('documents');
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// ==========================================
// 5. DASHBOARD & EDITOR LOGIK (NEU)
// ==========================================
async function loadRecentDocs() {
    if (!recentDocsList) return;
    recentDocsList.innerHTML = '<div class="empty-state-text">Lade Dokumente...</div>';

    try {
        const recentDocs = await getAllDocumentsFromDB();
        // Neueste Dokumente zuerst anzeigen (Sortierung nach Datum)
        recentDocs.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
        
        recentDocsList.innerHTML = '';

        if (recentDocs.length === 0) {
            recentDocsList.innerHTML = '<div class="empty-state-text">Noch keine Dokumente vorhanden. Klicke auf "Leeres Dokument", um zu starten!</div>';
            return;
        }

        recentDocs.forEach(doc => {
            const item = document.createElement('div');
            item.className = 'recent-item';
            // Wir nutzen hier escapeHTML aus der Sicherheits-Korrektur!
            item.innerHTML = `
                <div style="display:flex; align-items:center; gap:12px;">
                    <div class="recent-icon"><i data-lucide="file-text"></i></div>
                    <div class="recent-info">
                        <div class="recent-title">${escapeHTML(doc.title)}</div>
                        <div class="recent-meta">Zuletzt bearbeitet: ${new Date(doc.lastModified).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })} Uhr</div>
                    </div>
                </div>
                <button class="recent-delete-btn" title="Dokument löschen"><i data-lucide="trash-2"></i></button>
            `;
            
            // Klick aufs Dokument -> Öffnet den Editor
            item.addEventListener('click', () => openEditorWithDoc(doc.id));
            
            // Löschen Button
            const deleteBtn = item.querySelector('.recent-delete-btn');
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`Möchtest du "${doc.title}" wirklich unwiderruflich löschen?`)) {
                    await deleteDocumentFromDB(doc.id);
                    loadRecentDocs(); // Liste neu laden
                }
            });
            recentDocsList.appendChild(item);
        });
        
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (error) {
        console.error("Fehler beim Laden:", error);
        recentDocsList.innerHTML = '<div class="empty-state-text">Fehler beim Laden der Dokumente.</div>';
    }
}

// Diese Funktion ersetzt dein altes openEditor()
async function openEditorWithDoc(id) {
    try {
        let title = 'Unbenanntes Dokument';
        let content = '';

        if (id) {
            // Bestehendes Dokument aus der Datenbank laden
            const doc = await getDocumentFromDB(id);
            if (doc) {
                currentDocId = doc.id; // WICHTIG: Die globale ID für Autosave setzen
                title = doc.title;
                content = doc.content;
            }
        } else {
            // Komplett neues Dokument
            currentDocId = 'doc_' + Date.now();
        }

        // UI updaten (Titel setzen)
        if (docTitleInput) docTitleInput.value = title;
        
        const pageStack = document.getElementById('pageStack');
        if (content) {
            // Inhalt aus der DB ins DOM einfügen
            pageStack.innerHTML = content;
            reattachEditorEvents(); // Event-Listener für geladenen HTML-Code wiederherstellen
        } else {
            // Leeres Dokument
            pageStack.innerHTML = '';
            createPage(); 
        }

        // Wechsel vom Dashboard in die App
        if (dashboard) dashboard.style.display = 'none';
        if (mainApp) mainApp.style.display = 'flex';
        
        updateStats(); // Statistik sofort aktualisieren
        
    } catch (error) {
        console.error("Fehler beim Öffnen:", error);
        toast("❌ Dokument konnte nicht geladen werden!");
    }
}

// Hilfsfunktion: Da wir HTML aus der Datenbank in die App laden,
// müssen wir dem Editor wieder beibringen, auf Tippen und Tasten zu reagieren.
function reattachEditorEvents() {
    document.querySelectorAll('.editor').forEach(ed => {
        ed.addEventListener('input', () => {
            updateStats(); 
            scheduleAutoSave(); 
            handlePageFlow(ed.parentElement, ed);
            if (tocPanel.style.display === 'flex') buildTOC();
        });
        ed.addEventListener('keydown', e => {
            if (e.key === 'Tab') { 
                e.preventDefault(); 
                document.execCommand('insertText', false, '\t'); 
            }
        });
    });
}
async function saveDocumentToDB(id, title, content) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('documents', 'readwrite');
        const store = tx.objectStore('documents');
        const request = store.put({
            id: id,
            title: title,
            content: content,
            lastModified: new Date().toISOString()
        });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}
if (newDocBtn) {
  newDocBtn.addEventListener('click', () => {
    openEditorWithDoc(null);
  });
}
if (backToDashBtn) {
    backToDashBtn.addEventListener('click', async () => {
        try {
            const content = document.getElementById('pageStack').innerHTML;
            const title = document.getElementById('docTitle').value || 'Unbenanntes Dokument';
            
            // Falls currentDocId leer ist, eine neue generieren
            if (!currentDocId) {
                currentDocId = 'doc_' + Date.now();
            }

            // Versuche zu speichern
            await saveDocumentToDB(currentDocId, title, content);
            
            // Erst wenn erfolgreich, Ansicht umschalten
            if (mainApp) mainApp.style.display = 'none';
            if (dashboard) dashboard.style.display = 'flex';
            loadRecentDocs();
            
        } catch (error) {
            console.error("Fehler beim Speichern vor dem Dashboard-Wechsel:", error);
            // Fallback: Trotzdem zum Dashboard wechseln, damit der Nutzer nicht stecken bleibt
            if (mainApp) mainApp.style.display = 'none';
            if (dashboard) dashboard.style.display = 'flex';
            loadRecentDocs();
        }
    });
}
/* ── NEWS CONFIGURATION ── */
const newsFeedContainer = document.getElementById('newsFeedContainer');

function loadNews() {
    if (!newsFeedContainer) return;

    fetch('news.json')
        .then(response => {
            if (!response.ok) {
                throw new Error("News konnte nicht geladen werden");
            }
            return response.json();
        })
        .then(news => {
            renderNews(news);
        })
        .catch(error => {
            console.error(error);
            newsFeedContainer.innerHTML =
                '<div class="empty-state-text">Keine Neuigkeiten verfügbar.</div>';
        });
}

function renderNews(news) {
    if (!newsFeedContainer) return;

    newsFeedContainer.innerHTML = '';

    if (!news || news.length === 0) {
        newsFeedContainer.innerHTML =
            '<div class="empty-state-text">Aktuell keine Neuigkeiten vorhanden.</div>';
        return;
    }

    news.forEach(item => {
        const card = document.createElement('div');
        card.className = 'news-card';

        const metaDiv = document.createElement('div');
        metaDiv.className = 'news-card-meta';

        const badgeSpan = document.createElement('span');
        badgeSpan.className = 'news-badge';
        badgeSpan.textContent = item.badge || 'Update';
        metaDiv.appendChild(badgeSpan);

        const titleH4 = document.createElement('h4');
        titleH4.textContent = item.title || '';

        const contentP = document.createElement('p');
        contentP.textContent = item.content || '';

        card.appendChild(metaDiv);
        card.appendChild(titleH4);
        card.appendChild(contentP);

        newsFeedContainer.appendChild(card);
    });

    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// App-Start
loadNews();

// Falls loadRecentDocs in einer anderen Datei definiert ist:
if (typeof loadRecentDocs === 'function') {
    loadRecentDocs();
}
  /* ── REFS ────────────────────────────────────────────────── */
  const pageStack     = document.getElementById('pageStack');
  const workspace     = document.getElementById('workspace');
  const toastEl       = document.getElementById('toastEl');
  const themeSelector = document.getElementById('themeSelector');
  const saveIndicator = document.getElementById('saveIndicator');
  const saveText      = document.getElementById('saveText');
  const commentsPanel = document.getElementById('commentsPanel');
  const tocPanel      = document.getElementById('tocPanel');
  const tocContainer  = document.getElementById('tocContainer');
  const rulerEl       = document.getElementById('ruler');

  let isDragging = false, dragSX, dragSY, imgSX, imgSY;
  let currentLH  = 1.75;
  let isReading  = false;
  let isFocus    = false;
  let wordGoal   = 0;

  /* ── PAGE DIMS (96 DPI) ───────────────────────────────────── */
  const pageDim = {
    custom:  {portrait: {w: 1000, h: 900}, landscape: {w: 900, h: 1000}},
    a3:      {portrait: {w: 1123, h: 1587}, landscape: {w: 1587, h: 1123}},
    a4:      {portrait: {w: 794, h: 1123},  landscape: {w: 1123, h: 794}},
    a5:      {portrait: {w: 559, h: 794},   landscape: {w: 794, h: 559}},
    legal:   {portrait: {w: 816, h: 1344},  landscape: {w: 1344, h: 816}},
    letter:  {portrait: {w: 816, h: 1056},  landscape: {w: 1056, h: 816}},
    tabloid: {portrait: {w: 1056, h: 1632}, landscape: {w: 1632, h: 1056}},
  };


  /* ── TOAST & AUTOSAVE ────────────────────────────────────── */
  let toastT;
  let autoSaveTimeout; 

  function toast(msg, ms=2600) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  // Echtes Autosave
  let currentDocId = 'doc_' + Date.now();
  
  function scheduleAutoSave() {
    clearTimeout(autoSaveTimeout); 
    autoSaveTimeout = setTimeout(async () => {
      try {
        const content = document.getElementById('pageStack').innerHTML;
        const title = document.getElementById('docTitle').value || 'Unbekanntes Dokument';
        await saveDocumentToDB(currentDocId, title, content);
      } catch (error) {
        console.error("Datenbank-Fehler:", error);
        toast("Fehler beim Speichern :(");
      }
    }, 1500);
  }

  /* ── THEME ────────────────────────────────────────────────── */
  function applyTheme(val) {
    document.body.className = '';
    if (val && val !== 'default') document.body.classList.add(val);
    const label = themeSelector.options[themeSelector.selectedIndex]?.text || '';
    document.getElementById('statusTheme').textContent = label.replace(/^\S+ /,'');
    localStorage.setItem('ns_theme_V54', val);
  }
  themeSelector.addEventListener('change', () => applyTheme(themeSelector.value));
  const savedTheme = localStorage.getItem('ns_theme_V54') || 'default';
  themeSelector.value = savedTheme;
  applyTheme(savedTheme);

  /* ── TAB-NAV ─────────────────────────────────────────────── */
  document.querySelectorAll('.tn-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tn-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.toolbar').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  /* ── TOOLBAR ACCORDION ───────────────────────────────────── */
  document.querySelectorAll('.group-label').forEach(label => {
    label.addEventListener('click', () => {
      const group = label.closest('.group');
      group.classList.toggle('closed');
    });
  });

  /* ── EXEC ────────────────────────────────────────────────── */
  function exec(cmd, val=null) {
    document.execCommand(cmd, false, val);
    const ed = getEd(); if(ed) ed.focus();
    updateStats(); scheduleAutoSave();
    if (tocPanel.style.display === 'flex') buildTOC();
  }
  function getEd() {
    const ae = document.activeElement;
    return (ae && ae.classList.contains('editor')) ? ae : document.querySelector('.editor');
  }

  /* ── FORMATIERUNG ─────────────────────────────────────────── */
  document.getElementById('bold').addEventListener('click',        () => exec('bold'));
  document.getElementById('italic').addEventListener('click',      () => exec('italic'));
  document.getElementById('underline').addEventListener('click',   () => exec('underline'));
  document.getElementById('strike').addEventListener('click',      () => exec('strikeThrough'));
  document.getElementById('subscript').addEventListener('click',   () => exec('subscript'));
  document.getElementById('superscript').addEventListener('click', () => exec('superscript'));
  document.getElementById('clearFormat').addEventListener('click', () => exec('removeFormat'));
  document.getElementById('alignLeft').addEventListener('click',   () => exec('justifyLeft'));
  document.getElementById('alignCenter').addEventListener('click', () => exec('justifyCenter'));
  document.getElementById('alignRight').addEventListener('click',  () => exec('justifyRight'));
  document.getElementById('alignJustify').addEventListener('click',() => exec('justifyFull'));
// Aufzählung (Unordered List) einfügen
document.getElementById('insertUl').addEventListener('click', function() {
    document.execCommand('insertUnorderedList', false, null);
});

// Nummerierung (Ordered List) einfügen
document.getElementById('insertOl').addEventListener('click', function() {
    document.execCommand('insertOrderedList', false, null);
});

// Horizontale Linie (Horizontal Rule) einfügen
document.getElementById('insertHr').addEventListener('click', function() {
    document.execCommand('insertHorizontalRule', false, null);
});
  document.getElementById('fontName').addEventListener('change',   e => exec('fontName', e.target.value));

  /* Sicheres Undo/Redo für exakt EIN Wort */
  let undoHistory = [];
  let redoHistory = [];

  function getCaretOffset(element) {
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return 0;
    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    return preCaretRange.toString().length;
  }

  function setCaretOffset(element, offset) {
    const range = document.createRange();
    const selection = window.getSelection();
    let currentOffset = 0;

    function traverseNodes(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (currentOffset + node.length >= offset) {
          range.setStart(node, offset - currentOffset);
          range.collapse(true);
          return true;
        }
        currentOffset += node.length;
      } else {
        for (let i = 0; i < node.childNodes.length; i++) {
          if (traverseNodes(node.childNodes[i])) return true;
        }
      }
      return false;
    }

    traverseNodes(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  document.getElementById('undo').addEventListener('click', () => {
    const editor = document.querySelector('.editor');
    if (!editor) return;

    const currentOffset = getCaretOffset(editor);
    const fullText = editor.innerText;
    
    const textBeforeCaret = fullText.slice(0, currentOffset);
    const textAfterCaret = fullText.slice(currentOffset);
    const wordMatch = textBeforeCaret.match(/(\s*\S+|\s+)$/);

    if (wordMatch) {
      undoHistory.push({ html: editor.innerHTML, caretOffset: currentOffset });
      redoHistory = []; 
      const matchLength = wordMatch[0].length;
      const newTextBefore = textBeforeCaret.slice(0, -matchLength);
      editor.innerText = newTextBefore + textAfterCaret;
      const newOffset = currentOffset - matchLength;
      setCaretOffset(editor, newOffset);
    }
    updateStats(); scheduleAutoSave();
  });

  document.getElementById('redo').addEventListener('click', () => {
    const editor = document.querySelector('.editor');
    if (!editor || undoHistory.length === 0) return;
    const currentOffset = getCaretOffset(editor);
    redoHistory.push({ html: editor.innerHTML, caretOffset: currentOffset });
    const previousState = undoHistory.pop();
    editor.innerHTML = previousState.html;
    setCaretOffset(editor, previousState.caretOffset);
    updateStats(); scheduleAutoSave();
  });

  document.getElementById('fontSize').addEventListener('change', e => {
    const sizeInPx = e.target.value + 'px';
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontSize', false, '7');
    document.querySelectorAll('.editor').forEach(ed => {
      ed.querySelectorAll('font[size="7"]').forEach(f => {
        f.removeAttribute('size');
        f.style.fontSize = sizeInPx;
      });
    });
    updateStats(); scheduleAutoSave();
  });
  
  document.getElementById('headingStyle').addEventListener('change', e => exec('formatBlock', e.target.value));

/* Schriftfarbe */ 
// 20 Hauptfarben
const baseColors = [
  [0, '0%'],      // 1. Spalte: Graustufen (inkl. Weiß & Schwarz)
  [0, '100%'],    // 2. Spalte: Rot
  [20, '100%'],   // 3. Spalte: Rotorange
  [40, '100%'],   // 4. Spalte: Orange
  [55, '100%'],   // 5. Spalte: Gelb
  [75, '100%'],   // 6. Spalte: Lime / Gelbgrün
  [95, '100%'],   // 7. Spalte: Hellgrün
  [120, '100%'],  // 8. Spalte: Reingrün
  [140, '100%'],  // 9. Spalte: Dunkelgrün
  [165, '100%'],  // 10. Spalte: Blaugrün / Mint
  [180, '100%'],  // 11. Spalte: Cyan / Türkis
  [200, '100%'],  // 12. Spalte: Azurblau
  [215, '100%'],  // 13. Spalte: Hellblau
  [230, '100%'],  // 14. Spalte: Mittelblau
  [245, '100%'],  // 15. Spalte: Dunkelblau
  [270, '100%'],  // 16. Spalte: Violett
  [290, '100%'],  // 17. Spalte: Purpur
  [310, '100%'],  // 18. Spalte: Magenta
  [330, '100%'],  // 19. Spalte: Pink-Rot
  [345, '100%']   // 20. Spalte: Himbeer / Karmesinrot
];

// 7 Helligkeitsstufen (von oben nach unten) für eine größere Palette
const lightnessLevels = [0, 1, 2, 3, 4, 5, 6]; 
const palette = document.getElementById('colorPalette');
const btn = document.getElementById('colorPickerBtn');
const indicator = document.getElementById('colorIndicator');
const colorIcon = btn.querySelector('.color-icon'); 
// 1. Farbpalette dynamisch aufbauen
lightnessLevels.forEach(row => {
  baseColors.forEach(c => {
    const colorCell = document.createElement('div');
    colorCell.classList.add('color-cell');
    
    let hslColor;
    
    if (c[1] === '0%') {
      const grayLightness = [100, 85, 70, 50, 35, 18, 0];
      hslColor = `hsl(0, 0%, ${grayLightness[row]}%)`;
    } else {
      const colorLightness = [93, 80, 65, 50, 38, 25, 15];
      hslColor = `hsl(${c[0]}, ${c[1]}, ${colorLightness[row]}%)`;
    }
    
    colorCell.style.backgroundColor = hslColor;
    
    colorCell.addEventListener('mousedown', (e) => {
      e.preventDefault(); 
    });
    
    // Klick-Event für die Farbe
    colorCell.addEventListener('click', (e) => {
      exec('foreColor', hslColor);
      
      // Anzeige unter dem Button aktualisieren
      indicator.style.backgroundColor = hslColor;
      
      // NEU: Textfarbe des "A" ebenfalls auf die gewählte Farbe setzen
      colorIcon.style.color = hslColor;
      
      // Palette schließen
      palette.style.display = 'none';
    });
    
    palette.appendChild(colorCell);
  });
});
// 2. Dropdown öffnen/schließen
btn.addEventListener('click', (e) => {
  e.stopPropagation();
  
  if (palette.style.display !== 'grid') {
    palette.style.display = 'grid';
  } else {
    palette.style.display = 'none';
  }
});

// Schließen, wenn man außerhalb klickt
document.addEventListener('click', () => {
  palette.style.display = 'none';
});
/* Highlighter */
const highlightPalette = document.getElementById('highlightPalette');
const highlightBtn = document.getElementById('highlightBtn');
const highlightIndicator = document.getElementById('highlightIndicator');

// Palette dynamisch aufbauen (gleiche Farben wie bei der Schrift)
lightnessLevels.forEach(row => {
  baseColors.forEach(c => {
    const colorCell = document.createElement('div');
    colorCell.classList.add('color-cell');
    
    let hslColor;
    if (c[1] === '0%') {
      const grayLightness = [100, 85, 70, 50, 35, 18, 0];
      hslColor = `hsl(0, 0%, ${grayLightness[row]}%)`;
    } else {
      const colorLightness = [93, 80, 65, 50, 38, 25, 15];
      hslColor = `hsl(${c[0]}, ${c[1]}, ${colorLightness[row]}%)`;
    }
    
    colorCell.style.backgroundColor = hslColor;
    
    colorCell.addEventListener('mousedown', (e) => e.preventDefault());
    
    colorCell.addEventListener('click', (e) => {
      exec('hiliteColor', hslColor);
      highlightIndicator.style.backgroundColor = hslColor;
      highlightPalette.style.display = 'none';
    });
    
    highlightPalette.appendChild(colorCell);
  });
});

// Dropdown öffnen/schließen für den Highlighter
highlightBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  // Schließe eventuell offene andere Menüs falls nötig
  highlightPalette.style.display = highlightPalette.style.display === 'grid' ? 'none' : 'grid';
});

// Globales Schließen bei Klick außerhalb
document.addEventListener('click', () => {
  highlightPalette.style.display = 'none';
});
  
  /* ── Zeilenabstand ────────────────────────────────────────── */
  const lhSelector = document.getElementById('lineHeightSelector');
  if (lhSelector) {
    lhSelector.addEventListener('change', () => {
      currentLH = parseFloat(lhSelector.value);
      document.querySelectorAll('.editor').forEach(ed => ed.style.lineHeight = currentLH);
      toast('Zeilenabstand: ' + currentLH);
    });
  }

  /* ── INNSETTING ──────────────────────────────────────────── */
  document.getElementById('insertDate').addEventListener('click', () => {
    const d = new Date().toLocaleDateString('de-DE',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    exec('insertHTML', `<strong>${d}</strong>`);
  });
  document.getElementById('insertTime').addEventListener('click', () =>
    exec('insertHTML', new Date().toLocaleTimeString('de-DE'))
  );

  // Emoji
  document.getElementById('emojiBtn').addEventListener('click', () => {
    const emojis = ['😊','👍','❤️','🔥','⭐','✅','❌','📝','💡','🎯','🚀','📚','🧠','💪','🎉','⚡','🌟','📊','🔬','🎨','🏆','✨','🌈','🦋','🍀','💎','🔑','🌸','🎵','🍕'];
    const old = document.getElementById('emoji-picker-popup');
    if (old) { old.remove(); return; }
    const popup = document.createElement('div');
    popup.id = 'emoji-picker-popup';
    popup.style.cssText = 'top:90px;left:50%;transform:translateX(-50%)';
    emojis.forEach(em => {
      const b = document.createElement('button');
      b.textContent = em; b.className = 'tb-btn';
      b.style.cssText = 'font-size:18px;padding:5px;border:none;background:transparent;box-shadow:none;min-height:32px';
      b.addEventListener('mouseenter', () => b.style.background = 'var(--accent-soft)');
      b.addEventListener('mouseleave', () => b.style.background = 'transparent');
      b.addEventListener('click', () => { exec('insertHTML', em); popup.remove(); });
      popup.appendChild(b);
    });
    document.body.appendChild(popup);
    setTimeout(() => document.addEventListener('click', function rm(e){
      if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('click',rm); }
    }), 50);
  });

  document.getElementById('linkBtn').addEventListener('click', () => {
    const url = prompt('URL eingeben:','https://');
    if (url) exec('createLink', url);
  });
  /* ── LAYOUT CONFIG ────────────────────────────────────────── */
  const elFormat = document.getElementById('paperFormat');
  const elOrientation = document.getElementById('paperOrientation');
  const elMargin = document.getElementById('marginSelector');
  const docStyle = document.documentElement.style;
  const padMap = { normal: '90px', narrow: '45px', wide: '120px' };

  function updateLayout() {
    const fmt = elFormat.value;
    const ori = elOrientation.value;
    const dim = pageDim[fmt]?.[ori] || pageDim.a4.portrait;
    const pad = padMap[elMargin.value] || '90px';

    docStyle.setProperty('--page-w', `${dim.w}px`);
    docStyle.setProperty('--page-h', `${dim.h}px`);
    docStyle.setProperty('--page-pad', pad);

    if (rulerEl) rulerEl.style.width = `${dim.w}px`;
    if (typeof updateDynamicPageCount === 'function') updateDynamicPageCount();
  }

  [elFormat, elOrientation, elMargin].forEach(el => el?.addEventListener('change', updateLayout));
  /* ── TABELLE (Dynamisch & Flexibel) ──────────────────── */
document.getElementById('tableBtn').addEventListener('click', () => {
  // 1. Auswahl des Tabellen-Typs
  const type = prompt(
    "Tabellen-Typ wählen:\n\n" +
    "1 = Klassisch (Kopfzeile oben)\n" +
    "2 = Liste (Kopfspalte links)\n" +
    "3 = Kombi (Kopfzeile + Kopfspalte)", 
    "1"
  );
  if (type !== "1" && type !== "2" && type !== "3") return;

  // 2. Eingabe (jetzt ohne harte 7x7 Begrenzung, aber mit Sinnvoll-Check)
  let rows = parseInt(prompt('Anzahl Zeilen:', '3') || '3');
  let cols = parseInt(prompt('Anzahl Spalten:', '3') || '3');

  // Validierung: Zahlen prüfen
  if (isNaN(rows) || isNaN(cols) || rows < 1 || cols < 1) return;
  
  if (rows > 10 || cols > 10) {
    alert('⚠️ Aus Übersichtslichtkeitsgründen sind maximal 10 Zeilen und 10 Spalten erlaubt!');
    return;
  }
  let html = '<div style="overflow-x: auto; width: 100%; margin: 10px 0;">';
  html += '<table style="border-collapse: collapse; width: 100%; table-layout: fixed; font-family: inherit; font-size: 14px;">';

  const cellStyle = 'border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; word-break: break-word; overflow: hidden;';
  const headerStyle = 'border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; background-color: #f3f4f6; font-weight: 600; color: #374151; word-break: break-word; overflow: hidden;';

  if (type === "1") {
    // --- TYP 1: Raster-Tabelle (Kopfzeile oben) ---
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      html += `<th style="${headerStyle}">Titel ${c + 1}</th>`;
    }
    html += '</tr>';

    for (let r = 1; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        html += `<td style="${cellStyle}">Inhalt</td>`;
      }
      html += '</tr>';
    }

  } else if (type === "2") {
    // --- TYP 2: Listen-Tabelle (Kopfspalte links) ---
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        if (c === 0) {
          html += `<th style="${headerStyle}">Eintrag ${r + 1}</th>`;
        } else {
          html += `<td style="${cellStyle}">Inhalt</td>`;
        }
      }
      html += '</tr>';
    }

  } else if (type === "3") {
    // --- TYP 3: Kombi-Tabelle (Kopfzeile oben UND Kopfspalte links) ---
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      html += `<th style="${headerStyle}">${c === 0 ? 'Bereich' : 'Titel ' + c}</th>`;
    }
    html += '</tr>';

    for (let r = 1; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        if (c === 0) {
          html += `<th style="${headerStyle}">Eintrag ${r + 1}</th>`;
        } else {
          html += `<td style="${cellStyle}">Inhalt</td>`;
        }
      }
      html += '</tr>';
    }
  }

  html += '</table></div><p><br></p>';
  exec('insertHTML', html);
  
  const typeNames = { "1": "Klassisch", "2": "Liste", "3": "Kombi" };
  toast(`📊 ${rows}×${cols} Tabelle (${typeNames[type]}) hinzugefügt`);
});

/* ── BILD VERWALTUNG & CLIPBOARD (Absolut stabil & Ruckelfrei) ── */
let isDraggingImg = false;
let activeImgWrap = null;
let startX = 0, startY = 0;
let initialLeft = 0, initialTop = 0;

// GARANTIERT: Findet IMMER eine Seite oder erstellt sofort eine
function getActivePage() {
  // 1. Ist gerade ein Element auf einer Seite fokussiert?
  let active = document.activeElement;
  let page = active ? active.closest('.page') : null;
  
  // 2. Falls nicht, nimm die letzte existierende Seite im Stack
  if (!page) {
    const pages = document.querySelectorAll('.page');
    page = pages.length > 0 ? pages[pages.length - 1] : null;
  }
  
  // 3. Fallback: Erstelle sofort eine neue Seite im Container
  if (!page) {
    const pageStack = document.getElementById('pageStack') || document.querySelector('.workspace') || document.body;
    page = document.createElement('div');
    page.className = 'page';
    page.innerHTML = `<div class="editor" contenteditable="true" data-placeholder="Hier mit dem Schreiben beginnen..."></div>`;
    pageStack.appendChild(page);
    
    const ed = page.querySelector('.editor');
    if (ed && typeof window.handlePageOverflow === 'function') {
      ed.addEventListener('input', (e) => window.handlePageOverflow(e.target));
    }
  }
  
  page.style.position = 'relative'; // Wichtig für absolute Positionierung
  return page;
}

// Bild-Wrapper selektieren
function selectImgWrapper(wrap) {
  document.querySelectorAll('.img-wrapper').forEach(x => x.classList.remove('selected'));
  document.querySelectorAll('.image-toolbar').forEach(tb => tb.remove());
  wrap.classList.add('selected');
  buildImgToolbar(wrap);
}

// Bild einfügen (Frei schwebend)
function insertImageToPage(dataUrl) {
  const page = getActivePage();
  
  const wrap = document.createElement('div');
  wrap.className = 'img-wrapper';
  wrap.setAttribute('contenteditable', 'false');
  
  // Exakte Positionierung auf der Seite
  wrap.style.cssText = 'position: absolute; left: 60px; top: 60px; width: 260px; z-index: 100; cursor: move; user-select: none;';
  wrap.setAttribute('data-width', '260');
  wrap.setAttribute('data-rotation', '0');
  wrap.setAttribute('data-flip', '0');
  wrap.setAttribute('data-filter', 'none');
  
  const img = document.createElement('img');
  img.src = dataUrl;
  img.style.cssText = 'width: 100%; height: auto; display: block; border-radius: 6px; pointer-events: none; -webkit-user-drag: none;';
  wrap.appendChild(img);
  
  page.appendChild(wrap);
  selectImgWrapper(wrap);
  
  if (typeof toast === 'function') toast('🖼️ Bild eingefügt');
}

// Komprimierung & WebP-Konvertierung
function compressAndInsertImage(file) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const MAX_WIDTH = 1200;
      const MAX_HEIGHT = 1200;
      let width = img.width;
      let height = img.height;
      if (width > height && width > MAX_WIDTH){
        height *= MAX_WIDTH / width;
        width = MAX_WIDTH;
      } else if (height > MAX_HEIGHT) {
        width *= MAX_HEIGHT / height;
        height = MAX_HEIGHT;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const compressedDataUrl = canvas.toDataURL('image/webp', 0.75);
      insertImageToPage(compressedDataUrl);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// 1. Datei-Upload via Button-Klick
const imageBtn = document.getElementById('imageBtn');
const imageUpload = document.getElementById('imageUpload');
if (imageBtn && imageUpload) {
  imageBtn.onclick = () => imageUpload.click();
  imageUpload.onchange = e => {
    const file = e.target.files[0]; 
    if (!file) return;
    compressAndInsertImage(file);
    e.target.value = '';
  };
}

// 2. Strg + V (Paste) Event-Handler für Zwischenablage
document.addEventListener('paste', e => {
  const clipboardData = e.clipboardData || window.clipboardData;
  if (!clipboardData) return;
  const items = clipboardData.items;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      e.preventDefault();
      const file = items[i].getAsFile();
      if (file) compressAndInsertImage(file);
      break;
    }
  }
});

// 3. FLÜSSIGES DRAG & DROP (Ruckelfrei via offsetLeft/offsetTop)
document.addEventListener('mousedown', e => {
  const wrap = e.target.closest('.img-wrapper');
  
  if (wrap) {
    if (e.target.closest('.image-toolbar')) return; // Klicks in der Toolbar zulassen

    isDraggingImg = true; 
    activeImgWrap = wrap;
    
    // Startkoordinaten der Maus & des Elements erfassen
    startX = e.clientX; 
    startY = e.clientY;
    initialLeft = wrap.offsetLeft; 
    initialTop = wrap.offsetTop;
    
    selectImgWrapper(wrap);
    e.preventDefault(); // Verhindert ungewolltes Markieren von Text
  } else if (!e.target.closest('.image-toolbar')) {
    document.querySelectorAll('.img-wrapper').forEach(x => x.classList.remove('selected'));
    document.querySelectorAll('.image-toolbar').forEach(tb => tb.remove());
  }
});

document.addEventListener('mousemove', e => {
  if (!isDraggingImg || !activeImgWrap) return;
  e.preventDefault();
  
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  
  activeImgWrap.style.left = (initialLeft + dx) + 'px';
  activeImgWrap.style.top  = (initialTop + dy) + 'px';
});

document.addEventListener('mouseup', () => {
  isDraggingImg = false;
  activeImgWrap = null;
});

// 4. Toolbar bauen & Bild-Aktionen
function buildImgToolbar(wrap) {
  const img = wrap.querySelector('img');
  const tb  = document.createElement('div');
  tb.className = 'image-toolbar';
  
  tb.style.cssText = 'position: absolute; top: -42px; left: 0; display: flex; gap: 4px; background: #ffffff; padding: 4px 8px; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 200; border: 1px solid #cbd5e1;';
  
  tb.innerHTML = `
    <button class="tb-btn" data-a="grow" title="Vergrößern">+</button>
    <button class="tb-btn" data-a="shrink" title="Verkleinern">-</button>
    <button class="tb-btn" data-a="rotate" title="Drehen">↻</button>
    <button class="tb-btn" data-a="flip" title="Spiegeln">↔</button>
    <button class="tb-btn" data-a="bw" title="Schwarz/Weiß">S/W</button>
    <button class="tb-btn" data-a="sepia" title="Sepia">Sepia</button>
    <button class="tb-btn" data-a="reset" title="Zurücksetzen">↺</button>
    <button class="tb-btn tb-btn-del" style="color: #ef4444; font-weight: bold;" data-a="del" title="Löschen">✕</button>`;
    
  tb.addEventListener('mousedown', e => e.stopPropagation());
  tb.addEventListener('click', e => {
    e.stopPropagation();
    const actionBtn = e.target.closest('[data-a]');
    if (!actionBtn) return;
    const a = actionBtn.dataset.a;
    
    let w    = parseInt(wrap.getAttribute('data-width') || 260);
    let rot  = parseInt(wrap.getAttribute('data-rotation') || 0);
    let fl   = wrap.getAttribute('data-flip') === '1';
    let filt = wrap.getAttribute('data-filter') || 'none';
    
    if (a === 'grow')    w = Math.min(w + 40, 800);
    if (a === 'shrink')  w = Math.max(w - 40, 60);
    if (a === 'rotate')  rot = (rot + 45) % 360;
    if (a === 'flip')    fl = !fl;
    if (a === 'bw')      filt = filt === 'grayscale(100%)' ? 'none' : 'grayscale(100%)';
    if (a === 'sepia')   filt = filt === 'sepia(75%)' ? 'none' : 'sepia(75%)';
    if (a === 'reset')   { w = 260; rot = 0; fl = false; filt = 'none'; }
    if (a === 'del')     { wrap.remove(); return; }
    
    wrap.style.width = w + 'px';
    wrap.setAttribute('data-width', w);
    wrap.setAttribute('data-rotation', rot);
    wrap.setAttribute('data-flip', fl ? '1' : '0');
    wrap.setAttribute('data-filter', filt);
    
    img.style.transform = `rotate(${rot}deg) scaleX(${fl ? -1 : 1})`;
    img.style.filter = filt;
  });
  
  wrap.appendChild(tb);
}
  /* ── ZOOM SYSTEM (SCROLL-FIXED!) ──────────────────────────── */
  const zoomEl = document.getElementById('zoom');
  const zoomLb = document.getElementById('zoomLabel');
  zoomEl.addEventListener('input', () => {
    /* Nutzt zoom statt CSS Transform für sauberes Scrolling in Chrome/Safari */
    document.getElementById('pageStack').style.zoom = (zoomEl.value/100);
    zoomLb.textContent = zoomEl.value+'%';
  });
  document.getElementById('zoomReset').addEventListener('click', () => {
    zoomEl.value = 100;
    document.getElementById('pageStack').style.zoom = 1;
    zoomLb.textContent = '100%';
  });

  /* ── SØK & ERSTATT ───────────────────────────────────────── */
  function clearHL() {
    document.querySelectorAll('.search-highlight').forEach(el => {
      el.replaceWith(document.createTextNode(el.textContent));
    });
  }
  document.getElementById('findBtn').addEventListener('click', () => {
    clearHL();
    const term = document.getElementById('searchBox').value.trim();
    if (!term) return;
    let count = 0;
    document.querySelectorAll('.editor').forEach(ed => {
      const walk = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while(walk.nextNode()) nodes.push(walk.currentNode);
      nodes.forEach(node => {
        const idx = node.nodeValue.toLowerCase().indexOf(term.toLowerCase());
        if (idx<0) return;
        count++;
        const before = document.createTextNode(node.nodeValue.slice(0,idx));
        const mark   = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.textContent = node.nodeValue.slice(idx, idx+term.length);
        const after = document.createTextNode(node.nodeValue.slice(idx+term.length));
        node.parentNode.replaceChild(after, node);
        node.parentNode.insertBefore(mark, after);
        node.parentNode.insertBefore(before, mark);
        if (count===1) mark.scrollIntoView({behavior:'smooth',block:'center'});
      });
    });
    toast(count ? `🔍 ${count} Übereinstimmung(en) gefunden` : '❌ Keine Übereinstimmungen');
  });

  document.getElementById('replaceBtn').addEventListener('click', () => {
    clearHL();
    const term = document.getElementById('searchBox').value.trim();
    const repl = document.getElementById('replaceBox').value;
    if (!term) return;
    let count=0;
    document.querySelectorAll('.editor').forEach(ed => {
      const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');
      if (re.test(ed.innerHTML)) { ed.innerHTML=ed.innerHTML.replace(re,repl); count++; }
    });
    updateStats();
    toast(count ? `✅ Erfolgreich ersetzt` : '❌ Keine Instanzen gefunden');
  });

  document.getElementById('clearFindBtn').addEventListener('click', () => {
    clearHL(); document.getElementById('searchBox').value=''; document.getElementById('replaceBox').value='';
  });

  /* ── MULTI-EXPORTS ───────────────────────────────────────── */
  document.getElementById('saveTXT').addEventListener('click', () => {
    let txt=''; document.querySelectorAll('.editor').forEach(ed => txt += ed.innerText+'\n\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt],{type:'text/plain;charset=utf-8'}));
    a.download = (document.getElementById('docTitle').value||'dokument')+'.txt'; a.click(); toast('💾 Als Textdatei exportiert');
  });

  document.getElementById('saveHTML').addEventListener('click', () => {
    let html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${document.getElementById('docTitle').value}</title><style>body{font-family:Inter,sans-serif;max-width:820px;margin:40px auto;padding:0 24px;line-height:1.7;color:#0f172a}h1{font-size:2rem;font-weight:800}h2{font-size:1.5rem;font-weight:700}blockquote{border-left:4px solid #5b54e8;padding-left:16px;color:#64748b;font-style:italic}table{border-collapse:collapse;width:100%}td,th{border:1px solid #e2e8f0;padding:10px}</style></head><body>`;
    document.querySelectorAll('.editor').forEach(ed => html += ed.innerHTML); html += '</body></html>';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
    a.download = (document.getElementById('docTitle').value||'dokument')+'.html'; a.click(); toast('🌐 Als HTML exportiert');
  });

  document.getElementById('saveMD').addEventListener('click', () => {
    let md = `# ${document.getElementById('docTitle').value || 'Dokument'}\n\n`;
    document.querySelectorAll('.editor').forEach(ed => {
      let html = ed.innerHTML;
      html = html.replace(/<h1>(.*?)<\/h1>/gi, '# $1\n\n').replace(/<h2>(.*?)<\/h2>/gi, '## $1\n\n').replace(/<h3>(.*?)<\/h3>/gi, '### $1\n\n').replace(/<b>(.*?)<\/b>|<strong>(.*?)<\/strong>/gi, '**$1$2**').replace(/<i>(.*?)<\/i>|<em>(.*?)<\/em>/gi, '*$1$2*').replace(/<blockquote>(.*?)<\/blockquote>/gi, '> $1\n\n').replace(/<li>(.*?)<\/li>/gi, '* $1\n').replace(/<br\s*\/?>/gi, '\n').replace(/<p>(.*?)<\/p>/gi, '$1\n\n');
      const tmp = document.createElement('div'); tmp.innerHTML = html; md += tmp.innerText + '\n\n';
    });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md.trim()],{type:'text/markdown;charset=utf-8'}));
    a.download = (document.getElementById('docTitle').value||'dokument')+'.md'; a.click(); toast('📝 Als Markdown (.md) exportiert');
  });

    document.getElementById('saveDOCX').addEventListener('click', () => {
    let htmlContent = "";
    document.querySelectorAll('.editor').forEach(ed => {
        htmlContent += ed.innerHTML + "<br>"; // Trennung zwischen mehreren Editoren
    });

    const sourceHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Export</title>
        </head>
        <body>
            ${htmlContent}
        </body>
        </html>
    `;

    const converted = htmlDocx.asBlob(sourceHTML);

    const filename = (document.getElementById('docTitle').value || 'Dokument') + '.docx';
    
    if (window.navigator && window.navigator.msSaveOrOpenBlob) {
        window.navigator.msSaveOrOpenBlob(converted, filename);
    } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(converted);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        
        // Aufräumen
        setTimeout(() => {
            document.body.removeChild(link);
            window.URL.revokeObjectURL(link.href);
        }, 100);
    }

    toast('Als DOCX Datei exportiert');
});
/*document.getElementById('saveNTS').addEventListener('click', () => {

    const docData = {
        title: document.getElementById('docTitle').value || 'Unbenannt',
        theme: document.getElementById('themeSelector').value,
        paperFormat: document.getElementById('paperFormat').value,
        orientation: document.getElementById('paperOrientation').value,
        pages: []
    };

    document.querySelectorAll('.page .editor').forEach(ed => {
        docData.pages.push(ed.innerHTML);
    });

    const jsonString = JSON.stringify(docData, null, 2);

    const blob = new Blob(
        [jsonString],
        { type: 'application/x-nts' }
    );

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${docData.title}.nts`;

    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast('Als Native .nts Datei exportiert/gespeichert');
});
document.getElementById('loadNTS').addEventListener('change', e => {

    const file = e.target.files[0];

    const reader = new FileReader();

    reader.onload = () => {
        const docData = JSON.parse(reader.result);

        console.log(docData);
        // hier Seiten wieder herstellen
    };

    reader.readAsText(file);
});*/
  /* ── STATISTIK & ZIEL-ENGINE ───────────────────────────────── */
  function computeStats() {
    let text=''; document.querySelectorAll('.editor').forEach(ed => text += ed.innerText+' '); text=text.trim();
    const words=text?text.split(/\s+/).length:0; const chars=text.length; const charsNS=text.replace(/\s/g,'').length;
    const paras=text?text.split(/\n\s*\n/).length:0; const sents=text?text.split(/[.!?]+/).filter(s=>s.trim()).length:0;
    return {words,chars,charsNS,paras,sents};
  }

  function updateStats() {
    const s=computeStats();
    document.getElementById('statWords').textContent=s.words;
    document.getElementById('statChars').textContent=s.chars;
    document.getElementById('statRead').textContent=Math.max(1,Math.ceil(s.words/200));
    document.getElementById('progressFill').style.width=Math.min((s.chars/3000)*100,100)+'%';
    if (wordGoal > 0) {
      const pct = Math.min(100, Math.round((s.words / wordGoal) * 100));
      document.getElementById('statGoal').textContent = `${s.words} / ${wordGoal}`;
      document.getElementById('goalPercent').textContent = `${pct}%`;
      document.getElementById('goalPill').style.color = pct >= 100 ? 'var(--accent2)' : 'var(--text-strong)';
    }
  }

  document.getElementById('setGoalBtn').addEventListener('click', () => {
    const val = parseInt(document.getElementById('wordGoalInput').value);
    if(isNaN(val) || val <= 0) {
      wordGoal = 0; document.getElementById('goalPill').style.display = 'none'; toast('🎯 Wortziel deaktiviert');
    } else {
      wordGoal = val; document.getElementById('goalPill').style.display = 'inline-block'; toast(`🎯 Wortziel auf ${val} Wörter gesetzt!`); updateStats();
    }
  });

  document.getElementById('wordCountBtn').addEventListener('click', () => {
    const s=computeStats();
    document.getElementById('mWords').textContent=s.words; document.getElementById('mChars').textContent=s.chars;
    document.getElementById('mCharsNoSp').textContent=s.charsNS; document.getElementById('mParas').textContent=s.paras;
    document.getElementById('mSents').textContent=s.sents; document.getElementById('mRead').textContent=Math.max(1,Math.ceil(s.words/200))+' Min.';
    document.getElementById('statsModal').classList.add('open');
  });
  document.getElementById('closeStatsModal').addEventListener('click', () => document.getElementById('statsModal').classList.remove('open'));

  /* ── DYNAMISCHES INHALTSVERZEICHNIS (TOC) ───────────────────── */
  document.getElementById('tocBtn').addEventListener('click', () => {
    if (tocPanel.style.display === 'none') { buildTOC(); tocPanel.style.display = 'flex'; toast('📋 Inhaltsverzeichnis geöffnet'); } else { tocPanel.style.display = 'none'; }
  });

  function buildTOC() {
    tocContainer.innerHTML = ''; let found = false;
    document.querySelectorAll('.editor').forEach((ed, pIdx) => {
      ed.querySelectorAll('h1, h2, h3').forEach((h, hIdx) => {
        found = true; const item = document.createElement('div');
        item.className = `toc-item toc-${h.tagName.toLowerCase()}`; item.textContent = h.textContent || 'Unbenannte Überschrift';
        if (!h.id) h.id = `toc-anchor-${pIdx}-${hIdx}`;
        item.addEventListener('click', () => { h.scrollIntoView({ behavior: 'smooth', block: 'center' }); const orig = h.style.backgroundColor; h.style.backgroundColor = 'var(--accent-soft)'; setTimeout(() => h.style.backgroundColor = orig, 800); });
        tocContainer.appendChild(item);
      });
    });
    if(!found) tocContainer.innerHTML = '<div style="font-size:11px;color:var(--text-dim);text-align:center;padding:8px;">Keine Überschriften (H1-H3) vorhanden.</div>';
  }

  /* ── SMART MODES & VIEW TOGGLES ──────────────────────────── */
  document.getElementById('readingModeBtn').addEventListener('click', () => {
    isReading=!isReading; document.querySelectorAll('.editor').forEach(ed => ed.contentEditable=isReading?'false':'true'); toast(isReading?'📖 Lesemodus aktiviert':'✏️ Bearbeitungsmodus');
  });

  document.getElementById('focusModeBtn').addEventListener('click', () => {
    isFocus=!isFocus; document.body.classList.toggle('focus-mode',isFocus); toast(isFocus?'🧘 Fokus-Modus aktiviert':'✏️ Normalansicht');
  });

  document.getElementById('fullscreenBtn').addEventListener('click', () => {
    if (!document.fullscreenElement) { document.documentElement.requestFullscreen().then(() => toast('📺 Vollbild aktiviert')); } else { document.exitFullscreen(); toast('📺 Vollbild beendet'); }
  });

  function toggleCommentsPanel() {
    const currentDisplay = window.getComputedStyle(commentsPanel).display;
    if (currentDisplay === 'none') { commentsPanel.style.display = 'flex'; } else { commentsPanel.style.display = 'none'; }
  }
  document.getElementById('toggleComments').addEventListener('click', toggleCommentsPanel);
  window.addEventListener('keydown', (e) => { if (e.altKey && e.key.toLowerCase() === 'c') { e.preventDefault(); toggleCommentsPanel(); }});
  document.addEventListener('keydown', (e) => { if (e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); if (!document.fullscreenElement) { document.documentElement.requestFullscreen().then(() => toast('📺 Vollbild aktiviert')); } else { document.exitFullscreen(); toast('📺 Vollbild beendet'); } }});

  /* ── KOMMENTARVERWALTUNG ─────────────────────────────────── */
  document.getElementById('commentBtn').addEventListener('click', () => {
    const text = prompt('Kommentar hinzufügen:'); if (!text) return;
    const box = document.createElement('div'); box.className = 'comment-card';
    const now = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    box.innerHTML = `💡 ${text}<div class="comment-time">${now}</div><button class="comment-del tb-btn">✕</button>`;
    box.querySelector('.comment-del').addEventListener('click', () => { box.remove(); if (commentsPanel.children.length === 0) commentsPanel.style.display = 'none'; });
    commentsPanel.appendChild(box); commentsPanel.style.display = 'flex'; toast('💬 Kommentar hinzugefügt');
  });

  /* ── DIKTIERFUNKTION ───────────────────────── */
  let isListening = false; let recognition = null;
  document.getElementById('dictateBtn').addEventListener('click', () => {
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) { toast('❌ Browser unterstützt keine Spracherkennung.'); return; }
    if (isListening) { recognition?.stop(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR(); recognition.lang = 'de-DE'; recognition.continuous = true; recognition.interimResults = false; 
    recognition.onresult = e => { if (e.results[e.resultIndex].isFinal) exec('insertHTML', e.results[e.resultIndex][0].transcript.trim() + ' '); };
    recognition.onerror = () => { isListening = false; document.getElementById('dictateBtn').classList.remove('active-fmt'); toast('❌ Diktat fehlgeschlagen'); };
    recognition.onend = () => { isListening = false; document.getElementById('dictateBtn').classList.remove('active-fmt'); toast('🎙️ Diktat gestoppt'); };
    recognition.start(); isListening = true; document.getElementById('dictateBtn').classList.add('active-fmt'); toast('🎙️ Höre zu...');
  });

// ==========================================
// FUNKTIONEN: HINTERGRUND, TEXTFELDER & FORMEN
// ==========================================

// 1. Hintergrundfarbe des Blattes ändern
const pageBgColorInput = document.getElementById('pageBgColor');

if (pageBgColorInput) {
    pageBgColorInput.addEventListener('input', (e) => {
        const selectedColor = e.target.value;
        
        // Setzt die Variable global auf das HTML-Element
        document.documentElement.style.setProperty('--page-bg', selectedColor);
        
        // Fallback: Falls du .page-Elemente direkt stylen willst
        const pages = document.querySelectorAll('.page');
        pages.forEach(page => {
            page.style.backgroundColor = selectedColor;
        });
    });
}
let activeElement = null;

// Klick auf Hintergrund hebt die Auswahl auf
document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.floating-element') && !e.target.closest('.element-toolbar')) {
        if (activeElement) {
            activeElement.classList.remove('is-active');
            activeElement = null;
        }
    }
});

function addFloatingElement(elementHtml, className) {
    const targetPage = document.querySelector('.page') || document.getElementById('pageStack').firstElementChild;
    if (!targetPage) return;

    const wrapper = document.createElement('div');
    wrapper.className = `floating-element ${className}`;
    wrapper.style.left = '100px';
    wrapper.style.top = '100px';
    wrapper.style.width = '200px';
    wrapper.style.height = '150px';
    
    // Drag-Handle hinzugefügt (Standard-Greifpunkt für Textfelder & Formen)
    wrapper.innerHTML = `
        <div class="element-drag-handle" title="Verschieben">☰</div>
        <div class="element-toolbar">
            <label class="color-picker-wrapper" title="Farbe ändern">
                <input type="color" class="toolbar-color" value="#3b82f6">
            </label>
            <div class="toolbar-divider"></div>
            <div class="toolbar-size">
                <input type="number" class="size-w" title="Breite (px)">
                <span>×</span> 
                <input type="number" class="size-h" title="Höhe (px)">
            </div>
            <div class="toolbar-divider"></div>
            <button class="floating-delete" title="Löschen">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
        <div class="element-content-wrapper">
            ${elementHtml}
        </div>
        <div class="resize-handle nw"></div>
        <div class="resize-handle ne"></div>
        <div class="resize-handle se"></div>
        <div class="resize-handle sw"></div>
        <div class="rotate-handle" title="Drehen">↻</div>
    `;

    const innerShape = wrapper.querySelector('.floating-shape, .floating-textbox');
    const inputW = wrapper.querySelector('.size-w');
    const inputH = wrapper.querySelector('.size-h');
    const colorInput = wrapper.querySelector('.toolbar-color');
    const toolbar = wrapper.querySelector('.element-toolbar');

    function updateToolbarValues() {
        inputW.value = Math.round(wrapper.offsetWidth);
        inputH.value = Math.round(wrapper.offsetHeight);
    }

    // Fokus aktivieren
    wrapper.addEventListener('mousedown', (e) => {
        if (activeElement && activeElement !== wrapper) activeElement.classList.remove('is-active');
        activeElement = wrapper;
        wrapper.classList.add('is-active');
        updateToolbarValues();
    });

    // Toolbar Eingaben
    inputW.addEventListener('input', () => wrapper.style.width = `${Math.max(30, parseInt(inputW.value) || 0)}px`);
    inputH.addEventListener('input', () => wrapper.style.height = `${Math.max(30, parseInt(inputH.value) || 0)}px`);

    colorInput.addEventListener('input', (e) => {
        const color = e.target.value;
        if (innerShape) {
            innerShape.style.backgroundColor = color;
            if (innerShape.classList.contains('shape-line')) innerShape.style.borderColor = color;
        }
    });

    wrapper.querySelector('.floating-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        wrapper.remove();
        if (activeElement === wrapper) activeElement = null;
    });

    // Transformationsvariablen
    let currentRotation = 0;
    let isDragging = false, isResizing = false, isRotating = false;
    let startX, startY, initialLeft, initialTop, initialWidth, initialHeight, currentHandle = null;

    // --- DRAG & DROP START ---
    wrapper.addEventListener('mousedown', (e) => {
        // Erlaubt das Draggen über den Drag-Handle ODER über das Element selbst (sofern es kein Textfeld-Inhalt ist)
        const isHandle = e.target.classList.contains('element-drag-handle');
        const isTextboxSpace = e.target.classList.contains('floating-textbox');
        const isToolbar = e.target.closest('.element-toolbar');
        const isControl = e.target.classList.contains('resize-handle') || e.target.classList.contains('rotate-handle');

        if (isToolbar || isControl || (isTextboxSpace && !isHandle)) return;

        isDragging = true;
        wrapper.classList.add('is-dragging');
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = parseInt(wrapper.style.left) || 0;
        initialTop = parseInt(wrapper.style.top) || 0;
        e.stopPropagation();
    });

    // --- RESIZE START ---
    wrapper.querySelectorAll('.resize-handle').forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            currentHandle = e.target;
            startX = e.clientX;
            startY = e.clientY;
            initialWidth = wrapper.offsetWidth;
            initialHeight = wrapper.offsetHeight;
            initialLeft = parseInt(wrapper.style.left) || 0;
            initialTop = parseInt(wrapper.style.top) || 0;
            e.stopPropagation();
            e.preventDefault();
        });
    });

    // --- ROTATE START ---
    wrapper.querySelector('.rotate-handle').addEventListener('mousedown', (e) => {
        isRotating = true;
        e.stopPropagation();
        e.preventDefault();
    });

    // --- MOVE / RESIZE / ROTATE EXECUTION ---
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            wrapper.style.left = `${initialLeft + dx}px`;
            wrapper.style.top = `${initialTop + dy}px`;
        }
        
        if (isResizing && currentHandle) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (currentHandle.classList.contains('se')) {
                wrapper.style.width = `${Math.max(30, initialWidth + dx)}px`;
                wrapper.style.height = `${Math.max(30, initialHeight + dy)}px`;
            } else if (currentHandle.classList.contains('sw')) {
                wrapper.style.width = `${Math.max(30, initialWidth - dx)}px`;
                wrapper.style.height = `${Math.max(30, initialHeight + dy)}px`;
                wrapper.style.left = `${initialLeft + dx}px`;
            } else if (currentHandle.classList.contains('ne')) {
                wrapper.style.width = `${Math.max(30, initialWidth + dx)}px`;
                wrapper.style.height = `${Math.max(30, initialHeight - dy)}px`;
                wrapper.style.top = `${initialTop + dy}px`;
            } else if (currentHandle.classList.contains('nw')) {
                wrapper.style.width = `${Math.max(30, initialWidth - dx)}px`;
                wrapper.style.height = `${Math.max(30, initialHeight - dy)}px`;
                wrapper.style.left = `${initialLeft + dx}px`;
                wrapper.style.top = `${initialTop + dy}px`;
            }
            updateToolbarValues();
        }

        if (isRotating) {
            const rect = wrapper.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const rad = Math.atan2(e.clientY - centerY, e.clientX - centerX);
            
            currentRotation = rad * (180 / Math.PI) - 90;
            
            // Fix: Transform kombiniert anwenden, statt Überschreiben von Klassen-Transforms
            wrapper.style.transform = `rotate(${currentRotation}deg)`;
            // Konter-Rotation für die Toolbar, damit sie absolut stabil horizontal bleibt
            toolbar.style.transform = `translateX(-50%) rotate(${-currentRotation}deg)`;
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        isResizing = false;
        isRotating = false;
        currentHandle = null;
        wrapper.classList.remove('is-dragging');
    });

    targetPage.appendChild(wrapper);
}

// Button Event Listener
const textBoxBtn = document.getElementById('textBoxBtn');
if (textBoxBtn) {
    textBoxBtn.addEventListener('click', () => {
        const textHtml = `<div class="floating-textbox" contenteditable="true">Textfeld</div>`;
        addFloatingElement(textHtml, 'is-textbox');
    });
}

const shapeSelector = document.getElementById('shapeSelector');
if (shapeSelector) {
    shapeSelector.addEventListener('change', (e) => {
        const shapeType = e.target.value;
        if (!shapeType) return;
        
        let shapeHtml = '';
        if (shapeType === 'rect') shapeHtml = `<div class="floating-shape shape-rect"></div>`;
        if (shapeType === 'circle') shapeHtml = `<div class="floating-shape shape-circle"></div>`;
        if (shapeType === 'line') shapeHtml = `<div class="floating-shape shape-line" style="background-color:#2563eb; height:4px; top:calc(50% - 2px); position:absolute; width:100%;"></div>`;

        addFloatingElement(shapeHtml, 'is-shape');
        e.target.value = '';
    });
}
// --- Erweiterte Tastenkombinationen (Shortcuts) V0.6 ---
document.addEventListener('keydown', function(e) {
    const isCtrl = e.ctrlKey || e.metaKey;
    const isAlt = e.altKey;
    const isShift = e.shiftKey;
    const key = e.key.toLowerCase();

    // --- 1. FORMATIERUNG & EFFEKTE ---
    // Fett (Strg + B)
    if (isCtrl && !isShift && key === 'b') {
        e.preventDefault();
        document.getElementById('bold').click();
    }
    // Kursiv (Strg + I)
    if (isCtrl && !isShift && key === 'i') {
        e.preventDefault();
        document.getElementById('italic').click();
    }
    // Unterstrichen (Strg + U)
    if (isCtrl && !isShift && key === 'u') {
        e.preventDefault();
        document.getElementById('underline').click();
    }
    // NEU: Durchgestrichen (Strg + Shift + X)
    if (isCtrl && isShift && key === 'x') {
        e.preventDefault();
        document.getElementById('strike').click();
    }

    // --- 2. UNDO / REDO (Verbindet deine Buttons) ---
    // NEU: Rückgängig (Strg + Z)
    if (isCtrl && !isShift && key === 'z') {
        e.preventDefault();
        document.getElementById('undo').click();
    }
    // NEU: Wiederholen (Strg + Y)
    if (isCtrl && !isShift && key === 'y') {
        e.preventDefault();
        document.getElementById('redo').click();
    }

    // --- 3. EINFÜGEN & ELEMENTE ---
    // Aufzählungspunkte (Strg + Shift + L)
    if (isCtrl && isShift && key === 'l') {
        e.preventDefault();
        document.getElementById('insertUl').click();
    }
    // Nummerierte Liste (Strg + Shift + N)
    if (isCtrl && isShift && key === 'n') {
        e.preventDefault();
        document.getElementById('insertOl').click();
    }
    // NEU: Horizontale Trennlinie (Strg + H)
    if (isCtrl && !isShift && key === 'h') {
        e.preventDefault();
        document.getElementById('insertHr').click();
    }
    // NEU: Datum einfügen (Alt + D)
    if (isAlt && key === 'd') {
        e.preventDefault();
        document.getElementById('insertDate').click();
    }
    // NEU: Uhrzeit einfügen (Alt + T)
    if (isAlt && key === 't') {
        e.preventDefault();
        document.getElementById('insertTime').click();
    }
    // NEU: Tabelle einfügen (Alt + M)
    if (isAlt && key === 'm') {
        e.preventDefault();
        // Wechselt kurz zum Einfügen-Tab, damit man sieht, was passiert
        switchTab('tab-sett-inn');
        document.getElementById('tableBtn').click();
    }

    // --- 4. VIEWS, MODALS & TOOLS ---
    // Kommentar schreiben (Alt + K)
    if (isAlt && key === 'k') {
        e.preventDefault();
        document.getElementById('commentBtn').click();
    }
    // Vollbild (Alt + F)
    if (isAlt && key === 'f') {
        e.preventDefault();
        document.getElementById('fullscreenBtn').click();
    }
    // NEU: Fokusmodus (Alt + O)
    if (isAlt && key === 'o') {
        e.preventDefault();
        document.getElementById('focusModeBtn').click();
    }
    // Lesemodus aktivieren (Alt + R)
    if (isAlt && key === 'r') {
        e.preventDefault();
        document.getElementById('readingModeBtn').click();
    }
    // NEU: Dokumentenstatistik Modal öffnen (Alt + S)
    if (isAlt && key === 's') {
        e.preventDefault();
        document.getElementById('wordCountBtn').click();
    }
    // Suchen & Ersetzen öffnen (Strg + F)
    if (isCtrl && !isShift && key === 'f') {
        e.preventDefault();
        switchTab('tab-tool');
        setTimeout(() => document.getElementById('searchBox').focus(), 50);
    }
    // PDF Export / Speichern (Strg + S)
    if (isCtrl && !isShift && key === 's') {
        e.preventDefault();
        document.getElementById('lernappSaveBtn').click();
    }
	//Delete Picture ENTF
	document.addEventListener('keydown', e => {
    if (e.key === 'Delete' && activeImgWrap) {
        activeImgWrap.remove();
        activeImgWrap = null;
    }
});
// --- 5. NEU: QUICK-TAB-SWITCH (Alt + Zahl 1-7) ---
// Korrigiert: Nutzt e.code statt e.key, um Layout-Probleme zu vermeiden
if (isAlt && /^Digit[1-7]$/.test(e.code)) {
    e.preventDefault();
    // Holt die Zahl aus "DigitX" und zieht 1 ab für den Array-Index (0-6)
    const tabIndex = parseInt(e.code.replace('Digit', ''), 10) - 1;
    
    const tabs = [
        'tab-hjem',     // Alt + 1 (Index 0)
        'tab-sett-inn', // Alt + 2 (Index 1)
        'tab-format',   // Alt + 3 (Index 2)
        'tab-tool',     // Alt + 4 (Index 3)
        'tab-katalog',  // Alt + 5 (Index 4)
        'tab-export',   // Alt + 6 (Index 5)
        'tab-visning'   // Alt + 7 (Index 6)
    ];
    
    const targetTabId = tabs[tabIndex];
    if (targetTabId) {
        switchTab(targetTabId);
    }
}
});

// Hilfsfunktion zum Wechseln der Tabs im Ribbon (falls nicht global definiert)
function switchTab(tabId) {
    const tabButton = document.querySelector(`[data-tab="${tabId}"]`);
    if (tabButton) {
        tabButton.click();
    }
}
// Event für den manuellen Seitenumbruch-Button
const pageBreakBtn = document.getElementById('pageBreakBtn');
if(pageBreakBtn) {
    pageBreakBtn.addEventListener('click', () => {
        window.createPage();
        if(typeof toast === 'function') toast('Neue Seite erstellt!');
    });
}
  /* ── PDF EXPORT (STABIL!) ────────────────────────────────── */
  document.getElementById('lernappSaveBtn').addEventListener('click', () => { window.print(); });
  /* ── INITIALISIERUNG ─────────────────────────────────────── */
  window.updateStats = updateStats;
  window.scheduleAutoSave = scheduleAutoSave;
  window.buildTOC = typeof buildTOC !== 'undefined' ? buildTOC : null;
  if (typeof initSingleEditor === 'function') {
    initSingleEditor(currentLH);
  }
  updateStats();
  if (typeof setSaved === 'function'){setSaved(true);}else{const saveIndicator = document.getElementById('saveStatus'); if (saveIndicator) saveIndicator.textContent = 'Gespeichert;'}
  lucide.createIcons();
});