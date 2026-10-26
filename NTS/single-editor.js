document.addEventListener('DOMContentLoaded', () => {
    // Falls Seiten beim direkten Starten im DOM sind (Fallback)
    const editors = document.querySelectorAll('.editor');
    editors.forEach(editor => {
        editor.addEventListener('input', () => handlePageOverflow(editor));
    });
});

// Stellt sicher, dass script.js diese Methode aufrufen kann!
window.createPage = function() {
    const pageStack = document.getElementById('pageStack');
    if (!pageStack) return null;
    
    const newPage = document.createElement('div');
    newPage.className = 'page';
    newPage.innerHTML = `<div class="editor" contenteditable="true" data-placeholder="Hier mit dem Schreiben beginnen..."></div>`;
    
    pageStack.appendChild(newPage);
    const editor = newPage.querySelector('.editor');
    
    editor.addEventListener('input', (e) => handlePageOverflow(e.target));
    if (typeof window.updateMultiPageCount === 'function') window.updateMultiPageCount();
    
    return editor;
};

window.handlePageOverflow = function(editor) {
    if (!editor || !editor.parentNode) return;
    
    const page = editor.closest('.page');
    if (!page) return;
    
    const style = getComputedStyle(page);
    const maxHeight = parseFloat(style.height) - (parseFloat(style.paddingTop) + parseFloat(style.paddingBottom));
    
    let safetyCounter = 0;
    
    // Solange der Inhalt größer ist als die erlaubte Texthöhe der Seite
    while (editor.scrollHeight > maxHeight && safetyCounter < 50) {
        safetyCounter++;
        
        let nextPage = page.nextElementSibling;
        
        // Wenn keine nächste Seite da ist, erstellen wir eine
        if (!nextPage || !nextPage.classList.contains('page')) {
            nextPage = document.createElement('div');
            nextPage.className = 'page';
            nextPage.innerHTML = `<div class="editor" contenteditable="true" data-placeholder="Hier mit dem Schreiben beginnen..."></div>`;
            page.parentNode.insertBefore(nextPage, page.nextElementSibling);
            
            const nextEditor = nextPage.querySelector('.editor');
            nextEditor.addEventListener('input', (e) => window.handlePageOverflow(e.target));
        }
        
        const nextEditor = nextPage.querySelector('.editor');
        
        // Hole das letzte Kindelement des Editors (z.B. den letzten Absatz oder Block)
        const lastChild = editor.lastChild;
        
        if (lastChild) {
            // Vorn an die nächste Seite anhängen, damit die Reihenfolge stimmt
            nextEditor.prepend(lastChild);
        } else {
            break;
        }
    }
    // Leere Folgeseiten automatisch wieder entfernen (außer die erste Seite)
    const allPages = document.querySelectorAll('.page');
    for (let i = allPages.length - 1; i > 0; i--) {
        const p = allPages[i];
        const ed = p.querySelector('.editor');
        if (ed && ed.textContent.trim() === '' && ed.childNodes.length === 0) {
            p.remove();
        } else {
            break; 
        }
    }
    
    if (typeof window.updateMultiPageCount === 'function') {
        window.updateMultiPageCount();
    }
};
window.updateMultiPageCount = function() {
    const pageCount = document.querySelectorAll('.page').length;
    const statPages = document.getElementById('statPages');
    if (statPages) statPages.textContent = pageCount;
};

// Init Funktion für script.js
window.initSingleEditor = function(lineHeight) {
    const editors = document.querySelectorAll('.editor');
    editors.forEach(ed => {
        ed.style.lineHeight = lineHeight || 1.5;
        ed.addEventListener('input', () => window.handlePageOverflow(ed));
    });
    window.updateMultiPageCount();
};

// Save Status Funktion für script.js
window.setSaved = function(isSaved) {
    const indicator = document.getElementById('saveIndicator');
    const text = document.getElementById('saveText');
    if (indicator && text) {
        if (isSaved) {
            indicator.classList.remove('unsaved');
            indicator.classList.add('saved');
            text.textContent = 'Gespeichert';
        } else {
            indicator.classList.remove('saved');
            indicator.classList.add('unsaved');
            text.textContent = 'Speichern...';
        }
    }
};