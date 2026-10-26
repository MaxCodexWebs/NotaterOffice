"use strict";

/* =========================================================
   NOTATER BOLD
   Spreadsheet Engine
   Version 2
========================================================= */


/* =========================================================
   CONSTANTS
========================================================= */

const STORAGE_KEY = "notater-bold-workbook-v2";
const THEME_KEY = "notater-bold-theme-v2";

const DEFAULT_ROWS = 100;
const DEFAULT_COLS = 26;

const MIN_ROWS = 10;
const MIN_COLS = 5;

const MAX_ROWS = 1000;
const MAX_COLS = 100;

const AUTOSAVE_DELAY = 600;
const MAX_HISTORY = 80;


/* =========================================================
   APPLICATION STATE
========================================================= */

const state = {

    workbookName: "Meine Arbeitsmappe",

    sheets: [],

    activeSheetId: null,

    selectedRow: 0,
    selectedCol: 0,

    anchorRow: 0,
    anchorCol: 0,

    selection: {
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0
    },

    editing: false,

    zoom: 1,

    freezeHeader: false,

    dirty: false,

    autosaveTimer: null,

    history: [],
    historyIndex: -1,

    clipboard: null,

    searchResults: [],
    searchIndex: -1,

    formulaError: null

};


/* =========================================================
   DOM
========================================================= */

const $ = id => document.getElementById(id);

const els = {

    workbookName: $("workbookName"),
    saveStatus: $("saveStatus"),

    undoBtn: $("undoBtn"),
    redoBtn: $("redoBtn"),

    themeButton: $("themeButton"),
    fullscreenBtn: $("fullscreenBtn"),

    newBtn: $("newBtn"),
    openBtn: $("openBtn"),
    saveBtn: $("saveBtn"),
    csvExportBtn: $("csvExportBtn"),
    pdfBtn: $("pdfBtn"),
    printBtn: $("printBtn"),

    boldBtn: $("boldBtn"),
    italicBtn: $("italicBtn"),
    textColor: $("textColor"),
    fillColor: $("fillColor"),
    numberFormat: $("numberFormat"),

    insertRowBtn: $("insertRowBtn"),
    insertColBtn: $("insertColBtn"),
    deleteRowBtn: $("deleteRowBtn"),
    deleteColBtn: $("deleteColBtn"),

    freezeBtn: $("freezeBtn"),
    demoBtn: $("demoBtn"),
    searchBtn: $("searchBtn"),

    nameBox: $("nameBox"),
    formulaInput: $("formulaInput"),
    formulaCancel: $("formulaCancel"),
    formulaApply: $("formulaApply"),

    searchPanel: $("searchPanel"),
    searchInput: $("searchInput"),
    replaceInput: $("replaceInput"),
    findNextBtn: $("findNextBtn"),
    replaceBtn: $("replaceBtn"),
    replaceAllBtn: $("replaceAllBtn"),
    closeSearchBtn: $("closeSearchBtn"),

    sheetViewport: $("sheetViewport"),
    spreadsheet: $("spreadsheet"),
    sheetHead: $("sheetHead"),
    sheetBody: $("sheetBody"),
    sheetTabs: $("sheetTabs"),
    addSheetBtn: $("addSheetBtn"),

    cellStatus: $("cellStatus"),
    selectionStatus: $("selectionStatus"),
    calcStatus: $("calcStatus"),

    zoomOut: $("zoomOut"),
    zoomValue: $("zoomValue"),
    zoomIn: $("zoomIn"),
    zoomReset: $("zoomReset"),

    fileInput: $("fileInput"),

    toastContainer: $("toastContainer"),

    themeMenu: $("themeMenu")

};


/* =========================================================
   BASIC UTILITIES
========================================================= */

function uid(prefix = "id") {

    return (
        prefix +
        "_" +
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).slice(2, 8)
    );

}


function clamp(value, min, max) {

    return Math.max(
        min,
        Math.min(max, value)
    );

}


function deepClone(value) {

    return JSON.parse(
        JSON.stringify(value)
    );

}


function safeFileName(name) {

    return (
        String(name || "Notater_Bold")
            .replace(
                /[<>:"/\\|?*\x00-\x1F]/g,
                "_"
            )
            .trim()
            .slice(0, 120) ||
        "Notater_Bold"
    );

}


function showToast(
    message,
    type = "info"
) {

    if (!els.toastContainer) return;

    const toast =
        document.createElement("div");

    toast.className =
        `toast ${type}`;

    toast.textContent =
        message;

    els.toastContainer.appendChild(
        toast
    );

    setTimeout(() => {

        toast.style.opacity = "0";
        toast.style.transform =
            "translateY(5px)";

        setTimeout(
            () => toast.remove(),
            180
        );

    }, 2600);

}


/* =========================================================
   COLUMN / ADDRESS HELPERS
========================================================= */

function colToName(index) {

    let n = index + 1;
    let result = "";

    while (n > 0) {

        const remainder =
            (n - 1) % 26;

        result =
            String.fromCharCode(
                65 + remainder
            ) +
            result;

        n =
            Math.floor(
                (n - 1) / 26
            );

    }

    return result;

}


function nameToCol(name) {

    const letters =
        String(name)
            .toUpperCase()
            .replace(/[^A-Z]/g, "");

    if (!letters) return -1;

    let result = 0;

    for (const char of letters) {

        result =
            result * 26 +
            char.charCodeAt(0) -
            64;

    }

    return result - 1;

}


function cellAddress(row, col) {

    return (
        colToName(col) +
        String(row + 1)
    );

}


function parseAddress(address) {

    const match =
        String(address)
            .trim()
            .toUpperCase()
            .match(
                /^(\$?[A-Z]{1,3})\$?(\d+)$/
            );

    if (!match) return null;

    const col =
        nameToCol(
            match[1].replace("$", "")
        );

    const row =
        Number(match[2]) - 1;

    if (
        row < 0 ||
        col < 0 ||
        row >= MAX_ROWS ||
        col >= MAX_COLS
    ) {
        return null;
    }

    return {
        row,
        col
    };

}


function parseRange(range) {

    const parts =
        String(range)
            .trim()
            .toUpperCase()
            .split(":");

    const first =
        parseAddress(parts[0]);

    if (!first) return [];

    const last =
        parts[1]
            ? parseAddress(parts[1])
            : first;

    if (!last) return [];

    const startRow =
        Math.min(
            first.row,
            last.row
        );

    const endRow =
        Math.max(
            first.row,
            last.row
        );

    const startCol =
        Math.min(
            first.col,
            last.col
        );

    const endCol =
        Math.max(
            first.col,
            last.col
        );

    const cells = [];

    for (
        let row = startRow;
        row <= endRow;
        row++
    ) {

        for (
            let col = startCol;
            col <= endCol;
            col++
        ) {

            cells.push({
                row,
                col
            });

        }

    }

    return cells;

}


/* =========================================================
   CELL / SHEET FACTORIES
========================================================= */

function createCell(value = "") {

    return {

        value,

        style: {

            bold: false,
            italic: false,

            color: "",
            background: "",

            numberFormat: "general"

        }

    };

}


function createSheet(name) {

    const data = [];

    for (
        let row = 0;
        row < DEFAULT_ROWS;
        row++
    ) {

        const cells = [];

        for (
            let col = 0;
            col < DEFAULT_COLS;
            col++
        ) {

            cells.push(
                createCell("")
            );

        }

        data.push(cells);

    }

    return {

        id: uid("sheet"),

        name:
            sanitizeSheetName(name),

        rows: DEFAULT_ROWS,
        cols: DEFAULT_COLS,

        data

    };

}


/* =========================================================
   INITIALIZATION
========================================================= */

function init() {

    loadTheme();

    const loaded =
        loadWorkbook();

    if (!loaded) {

        createNewWorkbook(false);

    }

    bindEvents();

    resetSelection();

    render();

    if (
        state.history.length === 0
    ) {

        saveSnapshot();

    }

    updateHistoryButtons();

}


document.addEventListener(
    "DOMContentLoaded",
    init
);


/* =========================================================
   WORKBOOK
========================================================= */

function createNewWorkbook(
    resetHistory = true
) {

    state.workbookName =
        "Meine Arbeitsmappe";

    const sheet =
        createSheet("Tabelle1");

    state.sheets =
        [sheet];

    state.activeSheetId =
        sheet.id;

    state.selectedRow = 0;
    state.selectedCol = 0;

    state.anchorRow = 0;
    state.anchorCol = 0;

    state.selection = {

        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0

    };

    state.dirty = false;

    if (resetHistory) {

        resetHistory();

        saveSnapshot();

    }

}


function getActiveSheet() {

    return state.sheets.find(
        sheet =>
            sheet.id ===
            state.activeSheetId
    );

}


function getCell(row, col) {

    const sheet =
        getActiveSheet();

    if (!sheet) return null;

    if (
        row < 0 ||
        col < 0 ||
        row >= sheet.rows ||
        col >= sheet.cols
    ) {

        return null;

    }

    return sheet.data[row][col];

}


function ensureSheetDimensions(
    sheet,
    rows,
    cols
) {

    rows =
        clamp(
            rows,
            MIN_ROWS,
            MAX_ROWS
        );

    cols =
        clamp(
            cols,
            MIN_COLS,
            MAX_COLS
        );

    while (
        sheet.data.length < rows
    ) {

        const row = [];

        for (
            let col = 0;
            col < sheet.cols;
            col++
        ) {

            row.push(
                createCell("")
            );

        }

        sheet.data.push(row);

    }

    while (
        sheet.data.length > rows
    ) {

        sheet.data.pop();

    }

    for (const row of sheet.data) {

        while (
            row.length < cols
        ) {

            row.push(
                createCell("")
            );

        }

        while (
            row.length > cols
        ) {

            row.pop();

        }

    }

    sheet.rows = rows;
    sheet.cols = cols;

}


/* =========================================================
   SELECTION
========================================================= */

function resetSelection() {

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    state.selectedRow =
        clamp(
            state.selectedRow,
            0,
            sheet.rows - 1
        );

    state.selectedCol =
        clamp(
            state.selectedCol,
            0,
            sheet.cols - 1
        );

    state.anchorRow =
        state.selectedRow;

    state.anchorCol =
        state.selectedCol;

    state.selection = {

        startRow:
            state.selectedRow,

        startCol:
            state.selectedCol,

        endRow:
            state.selectedRow,

        endCol:
            state.selectedCol

    };

}


function setSelection(
    startRow,
    startCol,
    endRow = startRow,
    endCol = startCol
) {

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    startRow =
        clamp(
            startRow,
            0,
            sheet.rows - 1
        );

    endRow =
        clamp(
            endRow,
            0,
            sheet.rows - 1
        );

    startCol =
        clamp(
            startCol,
            0,
            sheet.cols - 1
        );

    endCol =
        clamp(
            endCol,
            0,
            sheet.cols - 1
        );

    state.selectedRow =
        endRow;

    state.selectedCol =
        endCol;

    state.selection = {

        startRow:
            Math.min(
                startRow,
                endRow
            ),

        startCol:
            Math.min(
                startCol,
                endCol
            ),

        endRow:
            Math.max(
                startRow,
                endRow
            ),

        endCol:
            Math.max(
                startCol,
                endCol
            )

    };

}


function selectCell(
    row,
    col,
    extend = false
) {

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    row =
        clamp(
            row,
            0,
            sheet.rows - 1
        );

    col =
        clamp(
            col,
            0,
            sheet.cols - 1
        );

    if (extend) {

        setSelection(
            state.anchorRow,
            state.anchorCol,
            row,
            col
        );

    } else {

        state.anchorRow = row;
        state.anchorCol = col;

        setSelection(
            row,
            col
        );

    }

    clearSearchHighlights();

    renderGrid();

    updateFormulaBar();

    updateStatus();

    scrollCellIntoView(
        row,
        col
    );

}


function getSelectedCells() {

    const cells = [];

    const {
        startRow,
        startCol,
        endRow,
        endCol
    } = state.selection;

    for (
        let row = startRow;
        row <= endRow;
        row++
    ) {

        for (
            let col = startCol;
            col <= endCol;
            col++
        ) {

            cells.push({
                row,
                col
            });

        }

    }

    return cells;

}


function isCellSelected(
    row,
    col
) {

    const s =
        state.selection;

    return (
        row >= s.startRow &&
        row <= s.endRow &&
        col >= s.startCol &&
        col <= s.endCol
    );

}


/* =========================================================
   RENDER
========================================================= */

function render() {

    if (!els.workbookName) return;

    els.workbookName.value =
        state.workbookName;

    renderTabs();

    renderGrid();

    updateFormulaBar();

    updateStatus();

    updateZoom();

    updateToolbarState();

}


function renderTabs() {

    if (!els.sheetTabs) return;

    els.sheetTabs.innerHTML = "";

    for (const sheet of state.sheets) {

        const tab =
            document.createElement("div");

        tab.className =
            "sheet-tab" +
            (
                sheet.id ===
                state.activeSheetId
                    ? " active"
                    : ""
            );

        tab.dataset.id =
            sheet.id;

        const title =
            document.createElement("span");

        title.className =
            "sheet-tab-title";

        title.textContent =
            sheet.name;

        const close =
            document.createElement("button");

        close.className =
            "sheet-tab-close";

        close.textContent = "×";

        close.title =
            "Tab schließen";

        tab.appendChild(title);
        tab.appendChild(close);

        tab.addEventListener(
            "click",
            event => {

                if (
                    event.target ===
                    close
                ) {

                    deleteSheet(
                        sheet.id
                    );

                    return;

                }

                if (
                    event.detail === 2
                ) {

                    renameSheet(
                        sheet.id
                    );

                    return;

                }

                activateSheet(
                    sheet.id
                );

            }
        );

        els.sheetTabs.appendChild(
            tab
        );

    }

}


function renderGrid() {

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    els.sheetHead.innerHTML = "";
    els.sheetBody.innerHTML = "";

    const headRow =
        document.createElement("tr");

    const corner =
        document.createElement("th");

    corner.className =
        "corner";

    corner.textContent = "⌗";

    headRow.appendChild(
        corner
    );

    for (
        let col = 0;
        col < sheet.cols;
        col++
    ) {

        const th =
            document.createElement("th");

        th.className =
            "col-header";

        th.textContent =
            colToName(col);

        th.dataset.col =
            col;

        headRow.appendChild(th);

    }

    els.sheetHead.appendChild(
        headRow
    );


    for (
        let row = 0;
        row < sheet.rows;
        row++
    ) {

        const tr =
            document.createElement("tr");

        const rowHeader =
            document.createElement("th");

        rowHeader.className =
            "row-header";

        rowHeader.textContent =
            String(row + 1);

        rowHeader.dataset.row =
            row;

        tr.appendChild(
            rowHeader
        );


        for (
            let col = 0;
            col < sheet.cols;
            col++
        ) {

            const cell =
                sheet.data[row][col];

            const td =
                document.createElement("td");

            td.dataset.row =
                row;

            td.dataset.col =
                col;

            const value =
                calculateCell(
                    sheet,
                    row,
                    col
                );

            td.textContent =
                formatDisplayValue(
                    value,
                    cell.style.numberFormat
                );

            applyCellStyle(
                td,
                cell
            );

            if (
                typeof cell.value ===
                    "string" &&
                cell.value.startsWith("=")
            ) {

                td.classList.add(
                    "formula-cell"
                );

            }

            if (
                typeof value ===
                    "string" &&
                value.startsWith("#")
            ) {

                td.classList.add(
                    "error-cell"
                );

            }

            if (
                isCellSelected(
                    row,
                    col
                )
            ) {

                td.classList.add(
                    "selected"
                );

            }

            td.addEventListener(
                "mousedown",
                onCellMouseDown
            );

            td.addEventListener(
                "dblclick",
                () =>
                    beginEdit(
                        row,
                        col
                    )
            );

            tr.appendChild(td);

        }

        els.sheetBody.appendChild(
            tr
        );

    }

    applyFreezeState();

}


function applyCellStyle(
    td,
    cell
) {

    if (
        !cell ||
        !cell.style
    ) return;

    td.classList.toggle(
        "bold-cell",
        !!cell.style.bold
    );

    td.classList.toggle(
        "italic-cell",
        !!cell.style.italic
    );

    if (cell.style.color) {

        td.style.color =
            cell.style.color;

    }

    if (cell.style.background) {

        td.style.background =
            cell.style.background;

    }

}


function updateToolbarState() {

    const cell =
        getCell(
            state.selectedRow,
            state.selectedCol
        );

    if (!cell) return;

    if (els.boldBtn) {

        els.boldBtn.classList.toggle(
            "active",
            !!cell.style.bold
        );

    }

    if (els.italicBtn) {

        els.italicBtn.classList.toggle(
            "active",
            !!cell.style.italic
        );

    }

    if (els.numberFormat) {

        els.numberFormat.value =
            cell.style.numberFormat ||
            "general";

    }

}


function applyFreezeState() {

    if (!els.sheetHead) return;

    els.sheetHead
        .querySelectorAll("th")
        .forEach(th => {

            th.style.position =
                "sticky";

            th.style.top = "0";

        });

}


/* =========================================================
   MOUSE SELECTION
========================================================= */

function onCellMouseDown(event) {

    const td =
        event.currentTarget;

    const row =
        Number(td.dataset.row);

    const col =
        Number(td.dataset.col);

    if (event.shiftKey) {

        setSelection(
            state.anchorRow,
            state.anchorCol,
            row,
            col
        );

    } else {

        state.anchorRow = row;
        state.anchorCol = col;

        setSelection(
            row,
            col
        );

    }

    clearSearchHighlights();

    renderGrid();

    updateFormulaBar();

    updateStatus();

}


/* =========================================================
   EDITING
========================================================= */

function beginEdit(
    row,
    col
) {

    if (state.editing) return;

    const td =
        els.sheetBody.querySelector(
            `td[data-row="${row}"][data-col="${col}"]`
        );

    const cell =
        getCell(row, col);

    if (!td || !cell) return;

    state.editing = true;

    state.selectedRow = row;
    state.selectedCol = col;

    td.classList.add(
        "editing"
    );

    td.textContent = "";

    const input =
        document.createElement("input");

    input.className =
        "cell-editor";

    input.value =
        cell.value ?? "";

    input.spellcheck = false;

    td.appendChild(input);

    input.focus();
    input.select();


    input.addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                "Enter"
            ) {

                event.preventDefault();

                finishEdit(
                    input.value,
                    "down"
                );

            }

            if (
                event.key ===
                "Escape"
            ) {

                event.preventDefault();

                cancelEdit();

            }

            if (
                event.key ===
                "Tab"
            ) {

                event.preventDefault();

                finishEdit(
                    input.value,
                    event.shiftKey
                        ? "left"
                        : "right"
                );

            }

        }
    );


    input.addEventListener(
        "blur",
        () => {

            if (state.editing) {

                finishEdit(
                    input.value,
                    null
                );

            }

        }
    );

}


function finishEdit(
    value,
    direction
) {

    if (!state.editing) return;

    const row =
        state.selectedRow;

    const col =
        state.selectedCol;

    const cell =
        getCell(row, col);

    state.editing = false;

    if (!cell) {

        render();

        return;

    }

    const newValue =
        String(value);

    if (
        cell.value !== newValue
    ) {

        saveSnapshot();

        cell.value =
            newValue;

        markDirty();

    }

    render();

    if (direction === "down") {

        selectCell(
            row + 1,
            col
        );

    }

    if (direction === "right") {

        selectCell(
            row,
            col + 1
        );

    }

    if (direction === "left") {

        selectCell(
            row,
            col - 1
        );

    }

}


function cancelEdit() {

    state.editing = false;

    render();

}


/* =========================================================
   FORMULA BAR
========================================================= */

function updateFormulaBar() {

    const cell =
        getCell(
            state.selectedRow,
            state.selectedCol
        );

    if (!cell) return;

    els.nameBox.textContent =
        cellAddress(
            state.selectedRow,
            state.selectedCol
        );

    els.formulaInput.value =
        cell.value ?? "";

}


function applyFormulaBar() {

    const cell =
        getCell(
            state.selectedRow,
            state.selectedCol
        );

    if (!cell) return;

    const value =
        els.formulaInput.value;

    if (
        cell.value === value
    ) return;

    saveSnapshot();

    cell.value =
        value;

    markDirty();

    render();

    showToast(
        "Zelle aktualisiert",
        "success"
    );

}


function cancelFormulaBar() {

    updateFormulaBar();

}


/* =========================================================
   FORMULA ENGINE
========================================================= */

function calculateCell(
    sheet,
    row,
    col,
    stack = new Set()
) {

    if (!sheet) return "";

    const cell =
        sheet.data[row]?.[col];

    if (!cell) return "";

    const raw =
        cell.value;

    if (
        raw === null ||
        raw === undefined ||
        raw === ""
    ) {

        return "";

    }

    if (
        typeof raw !== "string" ||
        !raw.startsWith("=")
    ) {

        return raw;

    }

    const key =
        `${sheet.id}:${row}:${col}`;

    if (stack.has(key)) {

        return "#ZIRKELBEZUG!";

    }

    stack.add(key);

    try {

        const formula =
            raw.slice(1).trim();

        if (!formula) {

            stack.delete(key);

            return "";

        }

        const result =
            evaluateFormula(
                formula,
                sheet,
                stack
            );

        stack.delete(key);

        return result;

    } catch (error) {

        stack.delete(key);

        console.warn(
            "Formula error:",
            raw,
            error
        );

        return "#FEHLER!";

    }

}


function evaluateFormula(
    formula,
    sheet,
    stack
) {

    /*
     * Normalize German formula separators.
     */
    formula =
        normalizeFormulaSeparators(
            formula
        );


    /*
     * Replace cell references with
     * numeric/string values.
     */
    formula =
        replaceCellReferences(
            formula,
            sheet,
            stack
        );


    /*
     * Evaluate functions with a
     * controlled parser.
     */
    return evaluateExpression(
        formula
    );

}


function normalizeFormulaSeparators(
    formula
) {

    let result = "";
    let quoted = false;

    for (
        let i = 0;
        i < formula.length;
        i++
    ) {

        const char =
            formula[i];

        if (
            char === '"'
        ) {

            quoted =
                !quoted;

            result += char;

            continue;

        }

        if (
            char === ";" &&
            !quoted
        ) {

            result += ",";

        } else {

            result += char;

        }

    }

    return result;

}


function replaceCellReferences(
    formula,
    sheet,
    stack
) {

    /*
     * References are recognized only
     * when outside quoted strings.
     */
    const regex =
        /(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)/g;

    let result = "";
    let lastIndex = 0;

    let match;

    while (
        (match =
            regex.exec(formula))
    ) {

        const before =
            formula.slice(
                lastIndex,
                match.index
            );

        result += before;

        const reference =
            match[1];

        const cells =
            parseRange(
                reference
                    .replace(/\$/g, "")
            );

        if (!cells.length) {

            result += "0";

        } else if (
            cells.length === 1
        ) {

            const target =
                cells[0];

            const value =
                calculateCell(
                    sheet,
                    target.row,
                    target.col,
                    new Set(stack)
                );

            result +=
                literalForExpression(
                    value
                );

        } else {

            /*
             * Ranges are represented as arrays.
             * Function calls consume these arrays.
             */
            const values =
                cells.map(
                    target => {

                        const value =
                            calculateCell(
                                sheet,
                                target.row,
                                target.col,
                                new Set(stack)
                            );

                        return value;

                    }
                );

            result +=
                JSON.stringify(values);

        }

        lastIndex =
            regex.lastIndex;

    }

    result +=
        formula.slice(lastIndex);

    return result;

}


function literalForExpression(
    value
) {

    if (
        typeof value === "number" &&
        Number.isFinite(value)
    ) {

        return String(value);

    }

    if (
        typeof value === "boolean"
    ) {

        return value
            ? "true"
            : "false";

    }

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {

        return '""';

    }

    if (
        typeof value === "string"
    ) {

        if (
            value.startsWith("#")
        ) {

            throw new Error(
                value
            );

        }

        return JSON.stringify(
            value
        );

    }

    return JSON.stringify(
        String(value)
    );

}


/*
 * This parser intentionally supports
 * the spreadsheet functions needed by
 * this application instead of exposing
 * arbitrary JavaScript execution.
 */

function evaluateExpression(
    expression
) {

    expression =
        expression.trim();


    /*
     * IF(...)
     */
    if (
        /^IF\s*\(/i.test(
            expression
        )
    ) {

        const inner =
            extractFunctionArguments(
                expression,
                "IF"
            );

        if (!inner) {

            throw new Error(
                "Invalid IF"
            );

        }

        const args =
            splitArguments(
                inner
            );

        if (args.length !== 3) {

            throw new Error(
                "IF requires 3 arguments"
            );

        }

        const condition =
            evaluateCondition(
                args[0]
            );

        return condition
            ? evaluateExpressionValue(
                args[1]
            )
            : evaluateExpressionValue(
                args[2]
            );

    }


    /*
     * Aggregate functions.
     */
    const functionMatch =
        expression.match(
            /^([A-Z]+)\s*\(([\s\S]*)\)$/i
        );

    if (functionMatch) {

        const name =
            functionMatch[1]
                .toUpperCase();

        const inner =
            functionMatch[2];

        const args =
            splitArguments(
                inner
            );

        const values =
            args.map(
                arg =>
                    evaluateExpressionValue(
                        arg
                    )
            );

        switch (name) {

            case "SUM":
                return formulaSUM(
                    ...values
                );

            case "AVERAGE":
                return formulaAVERAGE(
                    ...values
                );

            case "MIN":
                return formulaMIN(
                    ...values
                );

            case "MAX":
                return formulaMAX(
                    ...values
                );

            case "COUNT":
                return formulaCOUNT(
                    ...values
                );

            default:
                throw new Error(
                    `Unknown function: ${name}`
                );

        }

    }


    /*
     * Simple condition.
     */
    if (
        containsComparisonOperator(
            expression
        )
    ) {

        return evaluateCondition(
            expression
        );

    }


    /*
     * Arithmetic.
     */
    return evaluateArithmetic(
        expression
    );

}


function evaluateExpressionValue(
    expression
) {

    const value =
        expression.trim();

    if (
        value.startsWith("[") &&
        value.endsWith("]")
    ) {

        try {

            return JSON.parse(value);

        } catch (_) {

            throw new Error(
                "Invalid array"
            );

        }

    }

    if (
        value.startsWith('"') &&
        value.endsWith('"')
    ) {

        try {

            return JSON.parse(value);

        } catch (_) {

            return value.slice(
                1,
                -1
            );

        }

    }

    if (
        value.startsWith("'") &&
        value.endsWith("'")
    ) {

        return value.slice(
            1,
            -1
        );

    }

    if (
        /^TRUE$/i.test(value)
    ) {

        return true;

    }

    if (
        /^FALSE$/i.test(value)
    ) {

        return false;

    }

    if (
        containsComparisonOperator(
            value
        )
    ) {

        return evaluateCondition(
            value
        );

    }

    return evaluateArithmetic(
        value
    );

}


function evaluateArithmetic(
    expression
) {

    const trimmed =
        expression.trim();

    /*
     * A pure quoted string.
     */
    if (
        (
            trimmed.startsWith('"') &&
            trimmed.endsWith('"')
        ) ||
        (
            trimmed.startsWith("'") &&
            trimmed.endsWith("'")
        )
    ) {

        return evaluateExpressionValue(
            trimmed
        );

    }

    /*
     * A pure array is returned as-is.
     */
    if (
        trimmed.startsWith("[") &&
        trimmed.endsWith("]")
    ) {

        try {

            return JSON.parse(
                trimmed
            );

        } catch (_) {

            throw new Error(
                "Invalid array"
            );

        }

    }


    /*
     * Only arithmetic characters,
     * numbers, booleans and arrays.
     */
    const allowed =
        /^[0-9+\-*/().,\s[\]"A-Za-z_äöüÄÖÜß%]+$/;

    if (
        !allowed.test(trimmed)
    ) {

        throw new Error(
            "Unsupported expression"
        );

    }


    /*
     * Convert percentage syntax:
     * 10% -> 0.1
     */
    let normalized =
        trimmed.replace(
            /(\d+(?:\.\d+)?)%/g,
            "($1/100)"
        );


    /*
     * Resolve array values if a single
     * array is used in arithmetic.
     */
    normalized =
        normalized.replace(
            /\[([^\]]*)\]/g,
            match => {

                const values =
                    JSON.parse(match);

                return String(
                    normalizeNumeric(
                        values[0]
                    )
                );

            }
        );


    /*
     * Only arithmetic expressions reach
     * this small evaluator.
     */
    if (
        !/^[0-9+\-*/().\s]+$/.test(
            normalized
        )
    ) {

        /*
         * A plain string.
         */
        if (
            /^["'][\s\S]*["']$/.test(
                normalized
            )
        ) {

            return evaluateExpressionValue(
                normalized
            );

        }

        throw new Error(
            "Unsupported arithmetic"
        );

    }

    try {

        const result =
            Function(
                `"use strict"; return (${normalized});`
            )();

        if (
            typeof result !== "number" ||
            !Number.isFinite(result)
        ) {

            throw new Error(
                "Invalid number"
            );

        }

        return result;

    } catch (_) {

        throw new Error(
            "Invalid arithmetic"
        );

    }

}


function containsComparisonOperator(
    expression
) {

    return /<>|>=|<=|=|>|</.test(
        expression
    );

}


function evaluateCondition(
    expression
) {

    const match =
        expression.match(
            /^([\s\S]*?)(<>|>=|<=|=|>|<)([\s\S]*)$/
        );

    if (!match) {

        return Boolean(
            evaluateExpressionValue(
                expression
            )
        );

    }

    const left =
        evaluateExpressionValue(
            match[1]
        );

    const right =
        evaluateExpressionValue(
            match[3]
        );

    const operator =
        match[2];

    const numericLeft =
        normalizeNumericOrNull(
            left
        );

    const numericRight =
        normalizeNumericOrNull(
            right
        );

    const a =
        numericLeft !== null
            ? numericLeft
            : String(left);

    const b =
        numericRight !== null
            ? numericRight
            : String(right);

    switch (operator) {

        case "=":
            return a === b;

        case "<>":
            return a !== b;

        case ">":
            return a > b;

        case "<":
            return a < b;

        case ">=":
            return a >= b;

        case "<=":
            return a <= b;

        default:
            return false;

    }

}


function extractFunctionArguments(
    expression,
    functionName
) {

    const prefix =
        new RegExp(
            `^${functionName}\\s*\\(`,
            "i"
        );

    const match =
        expression.match(prefix);

    if (!match) return null;

    const start =
        match[0].length;

    if (
        expression[
            expression.length - 1
        ] !== ")"
    ) {

        return null;

    }

    return expression.slice(
        start,
        -1
    );

}


function splitArguments(
    text
) {

    const args = [];

    let current = "";
    let depth = 0;
    let quoted = false;

    for (
        let i = 0;
        i < text.length;
        i++
    ) {

        const char =
            text[i];

        if (
            char === '"'
        ) {

            quoted =
                !quoted;

            current += char;

            continue;

        }

        if (!quoted) {

            if (
                char === "(" ||
                char === "["
            ) {

                depth++;

            }

            if (
                char === ")" ||
                char === "]"
            ) {

                depth--;

            }

            if (
                char === "," &&
                depth === 0
            ) {

                args.push(
                    current.trim()
                );

                current = "";

                continue;

            }

        }

        current += char;

    }

    if (
        current.trim() !== ""
    ) {

        args.push(
            current.trim()
        );

    }

    return args;

}


function normalizeNumeric(
    value
) {

    if (
        typeof value === "number" &&
        Number.isFinite(value)
    ) {

        return value;

    }

    if (
        typeof value === "boolean"
    ) {

        return value ? 1 : 0;

    }

    if (
        typeof value === "string" &&
        value.trim() !== "" &&
        Number.isFinite(
            Number(
                value.replace(",", ".")
            )
        )
    ) {

        return Number(
            value.replace(",", ".")
        );

    }

    return 0;

}


function normalizeNumericOrNull(
    value
) {

    if (
        typeof value === "number" &&
        Number.isFinite(value)
    ) {

        return value;

    }

    if (
        typeof value === "string" &&
        value.trim() !== "" &&
        Number.isFinite(
            Number(
                value.replace(",", ".")
            )
        )
    ) {

        return Number(
            value.replace(",", ".")
        );

    }

    return null;

}


function flattenValues(
    values
) {

    const result = [];

    for (const value of values) {

        if (Array.isArray(value)) {

            result.push(
                ...flattenValues(value)
            );

        } else {

            result.push(value);

        }

    }

    return result;

}


function formulaSUM(
    ...args
) {

    return flattenValues(args)
        .reduce(
            (sum, value) =>
                sum +
                normalizeNumeric(value),
            0
        );

}


function formulaAVERAGE(
    ...args
) {

    const values =
        flattenValues(args)
            .map(
                normalizeNumericOrNull
            )
            .filter(
                value =>
                    value !== null
            );

    if (!values.length) return 0;

    return (
        values.reduce(
            (sum, value) =>
                sum + value,
            0
        ) /
        values.length
    );

}


function formulaMIN(
    ...args
) {

    const values =
        flattenValues(args)
            .map(
                normalizeNumericOrNull
            )
            .filter(
                value =>
                    value !== null
            );

    return values.length
        ? Math.min(...values)
        : 0;

}


function formulaMAX(
    ...args
) {

    const values =
        flattenValues(args)
            .map(
                normalizeNumericOrNull
            )
            .filter(
                value =>
                    value !== null
            );

    return values.length
        ? Math.max(...values)
        : 0;

}


function formulaCOUNT(
    ...args
) {

    return flattenValues(args)
        .filter(
            value =>
                normalizeNumericOrNull(
                    value
                ) !== null
        )
        .length;

}


/* =========================================================
   DISPLAY FORMATTING
========================================================= */

function formatDisplayValue(
    value,
    format
) {

    if (
        value === null ||
        value === undefined
    ) {

        return "";

    }

    if (
        typeof value === "string" &&
        value.startsWith("#")
    ) {

        return value;

    }

    if (value === "") return "";

    const number =
        normalizeNumericOrNull(
            value
        );

    switch (format) {

        case "number":

            if (number !== null) {

                return new Intl.NumberFormat(
                    "de-DE",
                    {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    }
                ).format(number);

            }

            break;


        case "currency":

            if (number !== null) {

                return new Intl.NumberFormat(
                    "de-DE",
                    {
                        style: "currency",
                        currency: "EUR"
                    }
                ).format(number);

            }

            break;


        case "percent":

            if (number !== null) {

                return new Intl.NumberFormat(
                    "de-DE",
                    {
                        style: "percent",
                        maximumFractionDigits: 2
                    }
                ).format(number);

            }

            break;


        case "date": {

            const date =
                value instanceof Date
                    ? value
                    : new Date(value);

            if (
                !Number.isNaN(
                    date.getTime()
                )
            ) {

                return date.toLocaleDateString(
                    "de-DE"
                );

            }

            break;

        }

    }

    return String(value);

}


/* =========================================================
   HISTORY
========================================================= */

function getSnapshot() {

    return {

        workbookName:
            state.workbookName,

        sheets:
            deepClone(
                state.sheets
            ),

        activeSheetId:
            state.activeSheetId,

        selectedRow:
            state.selectedRow,

        selectedCol:
            state.selectedCol

    };

}


function restoreSnapshot(
    snapshot
) {

    state.workbookName =
        snapshot.workbookName;

    state.sheets =
        deepClone(
            snapshot.sheets
        );

    state.activeSheetId =
        snapshot.activeSheetId;

    state.selectedRow =
        snapshot.selectedRow;

    state.selectedCol =
        snapshot.selectedCol;

    resetSelection();

    state.dirty = true;

    render();

}


function resetHistory() {

    state.history = [];

    state.historyIndex = -1;

}


function saveSnapshot() {

    const snapshot =
        getSnapshot();

    if (
        state.historyIndex >= 0 &&
        JSON.stringify(
            state.history[
                state.historyIndex
            ]
        ) ===
        JSON.stringify(snapshot)
    ) {

        return;

    }

    state.history =
        state.history.slice(
            0,
            state.historyIndex + 1
        );

    state.history.push(
        snapshot
    );

    if (
        state.history.length >
        MAX_HISTORY
    ) {

        state.history.shift();

    }

    state.historyIndex =
        state.history.length - 1;

    updateHistoryButtons();

}


function undo() {

    if (
        state.historyIndex <= 0
    ) {

        showToast(
            "Nichts rückgängig zu machen",
            "info"
        );

        return;

    }

    state.historyIndex--;

    restoreSnapshot(
        state.history[
            state.historyIndex
        ]
    );

    updateHistoryButtons();

    showToast(
        "Rückgängig",
        "info"
    );

}


function redo() {

    if (
        state.historyIndex >=
        state.history.length - 1
    ) {

        showToast(
            "Nichts wiederherzustellen",
            "info"
        );

        return;

    }

    state.historyIndex++;

    restoreSnapshot(
        state.history[
            state.historyIndex
        ]
    );

    updateHistoryButtons();

    showToast(
        "Wiederhergestellt",
        "info"
    );

}


function updateHistoryButtons() {

    if (!els.undoBtn) return;

    els.undoBtn.disabled =
        state.historyIndex <= 0;

    els.redoBtn.disabled =
        state.historyIndex >=
        state.history.length - 1;

    els.undoBtn.style.opacity =
        els.undoBtn.disabled
            ? ".4"
            : "1";

    els.redoBtn.style.opacity =
        els.redoBtn.disabled
            ? ".4"
            : "1";

}


/* =========================================================
   AUTOSAVE
========================================================= */

function markDirty() {

    state.dirty = true;

    if (els.saveStatus) {

        els.saveStatus.textContent =
            "Ungespeichert";

    }

    clearTimeout(
        state.autosaveTimer
    );

    state.autosaveTimer =
        setTimeout(
            saveLocal,
            AUTOSAVE_DELAY
        );

}


function saveLocal() {

    try {

        const payload = {

            version: 2,

            workbookName:
                state.workbookName,

            sheets:
                state.sheets,

            activeSheetId:
                state.activeSheetId,

            selectedRow:
                state.selectedRow,

            selectedCol:
                state.selectedCol

        };

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(payload)
        );

        state.dirty = false;

        if (els.saveStatus) {

            els.saveStatus.textContent =
                "Gespeichert";

        }

    } catch (error) {

        console.error(error);

        if (els.saveStatus) {

            els.saveStatus.textContent =
                "Speichern fehlgeschlagen";

        }

        showToast(
            "Lokales Speichern fehlgeschlagen",
            "error"
        );

    }

}


function loadWorkbook() {

    try {

        const raw =
            localStorage.getItem(
                STORAGE_KEY
            );

        if (!raw) return false;

        const payload =
            JSON.parse(raw);

        if (
            !payload ||
            !Array.isArray(
                payload.sheets
            ) ||
            !payload.sheets.length
        ) {

            return false;

        }

        state.workbookName =
            payload.workbookName ||
            "Meine Arbeitsmappe";

        state.sheets =
            payload.sheets;

        normalizeLoadedWorkbook();

        state.activeSheetId =
            state.sheets.some(
                sheet =>
                    sheet.id ===
                    payload.activeSheetId
            )
                ? payload.activeSheetId
                : state.sheets[0].id;

        state.selectedRow =
            Number.isInteger(
                payload.selectedRow
            )
                ? payload.selectedRow
                : 0;

        state.selectedCol =
            Number.isInteger(
                payload.selectedCol
            )
                ? payload.selectedCol
                : 0;

        resetHistory();

        saveSnapshot();

        return true;

    } catch (error) {

        console.error(error);

        localStorage.removeItem(
            STORAGE_KEY
        );

        return false;

    }

}


function normalizeLoadedWorkbook() {

    state.sheets =
        state.sheets.map(
            sheet => {

                sheet.id =
                    sheet.id ||
                    uid("sheet");

                sheet.name =
                    sanitizeSheetName(
                        sheet.name ||
                        "Tabelle"
                    );

                sheet.rows =
                    clamp(
                        Number(
                            sheet.rows
                        ) ||
                        DEFAULT_ROWS,
                        MIN_ROWS,
                        MAX_ROWS
                    );

                sheet.cols =
                    clamp(
                        Number(
                            sheet.cols
                        ) ||
                        DEFAULT_COLS,
                        MIN_COLS,
                        MAX_COLS
                    );

                if (
                    !Array.isArray(
                        sheet.data
                    )
                ) {

                    sheet.data = [];

                }

                while (
                    sheet.data.length <
                    sheet.rows
                ) {

                    sheet.data.push(
                        []
                    );

                }

                sheet.data =
                    sheet.data
                        .slice(
                            0,
                            sheet.rows
                        )
                        .map(
                            row => {

                                if (
                                    !Array.isArray(
                                        row
                                    )
                                ) {

                                    row = [];

                                }

                                while (
                                    row.length <
                                    sheet.cols
                                ) {

                                    row.push(
                                        createCell("")
                                    );

                                }

                                return row
                                    .slice(
                                        0,
                                        sheet.cols
                                    )
                                    .map(
                                        cell => {

                                            if (
                                                !cell ||
                                                typeof cell !==
                                                    "object"
                                            ) {

                                                return createCell(
                                                    cell ?? ""
                                                );

                                            }

                                            cell.style =
                                                cell.style ||
                                                {};

                                            cell.style.bold =
                                                !!cell.style.bold;

                                            cell.style.italic =
                                                !!cell.style.italic;

                                            cell.style.color =
                                                cell.style.color ||
                                                "";

                                            cell.style.background =
                                                cell.style.background ||
                                                "";

                                            cell.style.numberFormat =
                                                cell.style.numberFormat ||
                                                "general";

                                            return cell;

                                        }
                                    );

                            }
                        );

                return sheet;

            }
        );

}


/* =========================================================
   SHEETS
========================================================= */

function activateSheet(id) {

    const sheet =
        state.sheets.find(
            item =>
                item.id === id
        );

    if (!sheet) return;

    state.activeSheetId =
        id;

    state.selectedRow = 0;
    state.selectedCol = 0;

    resetSelection();

    render();

}


function addSheet() {

    let index = 1;

    while (
        state.sheets.some(
            sheet =>
                sheet.name ===
                `Tabelle${index}`
        )
    ) {

        index++;

    }

    const sheet =
        createSheet(
            `Tabelle${index}`
        );

    state.sheets.push(
        sheet
    );

    state.activeSheetId =
        sheet.id;

    state.selectedRow = 0;
    state.selectedCol = 0;

    saveSnapshot();

    markDirty();

    render();

    showToast(
        "Neues Tabellenblatt erstellt",
        "success"
    );

}


function renameSheet(id) {

    const sheet =
        state.sheets.find(
            item =>
                item.id === id
        );

    if (!sheet) return;

    const name =
        prompt(
            "Name des Tabellenblatts:",
            sheet.name
        );

    if (name === null) return;

    const clean =
        sanitizeSheetName(
            name
        );

    if (!clean) {

        showToast(
            "Der Tabellenname darf nicht leer sein.",
            "error"
        );

        return;

    }

    if (
        state.sheets.some(
            item =>
                item.id !== id &&
                item.name.toLowerCase() ===
                clean.toLowerCase()
        )
    ) {

        showToast(
            "Dieser Tabellenname existiert bereits.",
            "error"
        );

        return;

    }

    saveSnapshot();

    sheet.name =
        clean;

    markDirty();

    render();

}


function deleteSheet(id) {

    if (
        state.sheets.length <= 1
    ) {

        showToast(
            "Mindestens ein Tabellenblatt muss vorhanden sein.",
            "error"
        );

        return;

    }

    const sheet =
        state.sheets.find(
            item =>
                item.id === id
        );

    if (!sheet) return;

    if (
        !confirm(
            `Tab "${sheet.name}" wirklich löschen?`
        )
    ) {

        return;

    }

    saveSnapshot();

    const index =
        state.sheets.findIndex(
            item =>
                item.id === id
        );

    state.sheets =
        state.sheets.filter(
            item =>
                item.id !== id
        );

    if (
        state.activeSheetId === id
    ) {

        const next =
            state.sheets[
                clamp(
                    index,
                    0,
                    state.sheets.length - 1
                )
            ];

        state.activeSheetId =
            next.id;

    }

    resetSelection();

    markDirty();

    render();

}


function duplicateActiveSheet() {

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    const copy =
        deepClone(sheet);

    copy.id =
        uid("sheet");

    let name =
        `${sheet.name} Kopie`;

    let index = 2;

    while (
        state.sheets.some(
            item =>
                item.name === name
        )
    ) {

        name =
            `${sheet.name} Kopie ${index}`;

        index++;

    }

    copy.name =
        name;

    state.sheets.push(
        copy
    );

    state.activeSheetId =
        copy.id;

    saveSnapshot();

    markDirty();

    render();

    showToast(
        "Tab dupliziert",
        "success"
    );

}


/* =========================================================
   ROW / COLUMN OPERATIONS
========================================================= */

function insertRow() {

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    if (
        sheet.rows >= MAX_ROWS
    ) {

        showToast(
            "Maximale Zeilenanzahl erreicht.",
            "error"
        );

        return;

    }

    saveSnapshot();

    const row = [];

    for (
        let col = 0;
        col < sheet.cols;
        col++
    ) {

        row.push(
            createCell("")
        );

    }

    sheet.data.splice(
        state.selectedRow + 1,
        0,
        row
    );

    sheet.rows++;

    markDirty();

    render();

}


function insertColumn() {

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    if (
        sheet.cols >= MAX_COLS
    ) {

        showToast(
            "Maximale Spaltenanzahl erreicht.",
            "error"
        );

        return;

    }

    saveSnapshot();

    for (
        const row of sheet.data
    ) {

        row.splice(
            state.selectedCol + 1,
            0,
            createCell("")
        );

    }

    sheet.cols++;

    markDirty();

    render();

}


function deleteRow() {

    const sheet =
        getActiveSheet();

    if (
        !sheet ||
        sheet.rows <= MIN_ROWS
    ) {

        showToast(
            "Mindestens 10 Zeilen bleiben erhalten.",
            "error"
        );

        return;

    }

    saveSnapshot();

    sheet.data.splice(
        state.selectedRow,
        1
    );

    sheet.rows--;

    state.selectedRow =
        clamp(
            state.selectedRow,
            0,
            sheet.rows - 1
        );

    resetSelection();

    markDirty();

    render();

}


function deleteColumn() {

    const sheet =
        getActiveSheet();

    if (
        !sheet ||
        sheet.cols <= MIN_COLS
    ) {

        showToast(
            "Mindestens 5 Spalten bleiben erhalten.",
            "error"
        );

        return;

    }

    saveSnapshot();

    for (
        const row of sheet.data
    ) {

        row.splice(
            state.selectedCol,
            1
        );

    }

    sheet.cols--;

    state.selectedCol =
        clamp(
            state.selectedCol,
            0,
            sheet.cols - 1
        );

    resetSelection();

    markDirty();

    render();

}


/* =========================================================
   FORMATTING
========================================================= */

function applyStyleToSelection(
    key,
    value
) {

    const cells =
        getSelectedCells();

    if (!cells.length) return;

    saveSnapshot();

    const sheet =
        getActiveSheet();

    for (
        const { row, col } of cells
    ) {

        sheet.data[row][col]
            .style[key] = value;

    }

    markDirty();

    render();

}


function toggleBold() {

    const cell =
        getCell(
            state.selectedRow,
            state.selectedCol
        );

    if (!cell) return;

    applyStyleToSelection(
        "bold",
        !cell.style.bold
    );

}


function toggleItalic() {

    const cell =
        getCell(
            state.selectedRow,
            state.selectedCol
        );

    if (!cell) return;

    applyStyleToSelection(
        "italic",
        !cell.style.italic
    );

}


function changeTextColor(
    color
) {

    applyStyleToSelection(
        "color",
        color
    );

}


function changeFillColor(
    color
) {

    applyStyleToSelection(
        "background",
        color
    );

}


function changeNumberFormat(
    format
) {

    applyStyleToSelection(
        "numberFormat",
        format
    );

}


/* =========================================================
   COPY / CUT / PASTE
========================================================= */

async function copySelectedCells() {

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    const {
        startRow,
        startCol,
        endRow,
        endCol
    } = state.selection;

    const cells = [];

    for (
        let row = startRow;
        row <= endRow;
        row++
    ) {

        const line = [];

        for (
            let col = startCol;
            col <= endCol;
            col++
        ) {

            line.push(
                deepClone(
                    sheet.data[row][col]
                )
            );

        }

        cells.push(line);

    }

    state.clipboard = {

        rows: cells.length,
        cols: cells[0]?.length || 0,
        cells

    };

    const text =
        cells
            .map(
                row =>
                    row
                        .map(
                            cell =>
                                String(
                                    cell.value ??
                                    ""
                                )
                        )
                        .join("\t")
            )
            .join("\n");

    try {

        await navigator.clipboard.writeText(
            text
        );

    } catch (_) {}

    showToast(
        cells.length === 1 &&
        cells[0]?.length === 1
            ? "Zelle kopiert"
            : "Bereich kopiert",
        "success"
    );

}


async function cutSelectedCells() {

    await copySelectedCells();

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    saveSnapshot();

    for (
        const { row, col } of
        getSelectedCells()
    ) {

        sheet.data[row][col] =
            createCell("");

    }

    markDirty();

    render();

    showToast(
        "Ausgeschnitten",
        "success"
    );

}


async function pasteSelectedCells() {

    if (!state.clipboard) {

        try {

            const text =
                await navigator.clipboard.readText();

            if (!text) return;

            pasteTextGrid(
                text
            );

            return;

        } catch (_) {

            showToast(
                "Keine Daten zum Einfügen vorhanden.",
                "info"
            );

            return;

        }

    }

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    saveSnapshot();

    const clipboard =
        state.clipboard;

    const startRow =
        state.selection.startRow;

    const startCol =
        state.selection.startCol;

    for (
        let r = 0;
        r < clipboard.rows;
        r++
    ) {

        for (
            let c = 0;
            c < clipboard.cols;
            c++
        ) {

            const targetRow =
                startRow + r;

            const targetCol =
                startCol + c;

            if (
                targetRow >= sheet.rows ||
                targetCol >= sheet.cols
            ) {

                continue;

            }

            sheet.data[targetRow][targetCol] =
                deepClone(
                    clipboard.cells[r][c]
                );

        }

    }

    markDirty();

    render();

    showToast(
        "Eingefügt",
        "success"
    );

}


function pasteTextGrid(
    text
) {

    const rows =
        String(text)
            .split(/\r?\n/)
            .map(
                line =>
                    line.split("\t")
            );

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    saveSnapshot();

    const startRow =
        state.selectedRow;

    const startCol =
        state.selectedCol;

    for (
        let r = 0;
        r < rows.length;
        r++
    ) {

        for (
            let c = 0;
            c < rows[r].length;
            c++
        ) {

            const row =
                startRow + r;

            const col =
                startCol + c;

            if (
                row >= sheet.rows ||
                col >= sheet.cols
            ) {

                continue;

            }

            sheet.data[row][col].value =
                rows[r][c];

        }

    }

    markDirty();

    render();

    showToast(
        "Text eingefügt",
        "success"
    );

}


/* =========================================================
   SEARCH
========================================================= */

function openSearch() {

    els.searchPanel.classList.remove(
        "hidden"
    );

    els.searchInput.focus();

}


function closeSearch() {

    els.searchPanel.classList.add(
        "hidden"
    );

    clearSearchHighlights();

    state.searchResults = [];
    state.searchIndex = -1;

}


function clearSearchHighlights() {

    document
        .querySelectorAll(
            ".search-hit"
        )
        .forEach(
            element =>
                element.classList.remove(
                    "search-hit"
                )
        );

}


function rebuildSearchResults() {

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    const query =
        els.searchInput.value
            .trim()
            .toLowerCase();

    state.searchResults = [];
    state.searchIndex = -1;

    if (!query) return;

    for (
        let row = 0;
        row < sheet.rows;
        row++
    ) {

        for (
            let col = 0;
            col < sheet.cols;
            col++
        ) {

            const value =
                calculateCell(
                    sheet,
                    row,
                    col
                );

            if (
                String(value)
                    .toLowerCase()
                    .includes(query)
            ) {

                state.searchResults.push({
                    row,
                    col
                });

            }

        }

    }

}


function performSearch() {

    rebuildSearchResults();

    if (
        !state.searchResults.length
    ) {

        showToast(
            "Keine Treffer gefunden.",
            "info"
        );

        return;

    }

    state.searchIndex =
        (
            state.searchIndex + 1
        ) %
        state.searchResults.length;

    const result =
        state.searchResults[
            state.searchIndex
        ];

    selectCell(
        result.row,
        result.col
    );

    clearSearchHighlights();

    const td =
        els.sheetBody.querySelector(
            `td[data-row="${result.row}"][data-col="${result.col}"]`
        );

    if (td) {

        td.classList.add(
            "search-hit"
        );

    }

}


function replaceSelected() {

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    const query =
        els.searchInput.value;

    const replacement =
        els.replaceInput.value;

    if (!query) return;

    const cell =
        getCell(
            state.selectedRow,
            state.selectedCol
        );

    if (!cell) return;

    const current =
        String(
            cell.value ?? ""
        );

    if (
        !current
            .toLowerCase()
            .includes(
                query.toLowerCase()
            )
    ) {

        performSearch();

        return;

    }

    saveSnapshot();

    cell.value =
        current.replace(
            new RegExp(
                escapeRegExp(query),
                "gi"
            ),
            replacement
        );

    markDirty();

    render();

    showToast(
        "Ersetzt",
        "success"
    );

}


function replaceAll() {

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    const query =
        els.searchInput.value;

    const replacement =
        els.replaceInput.value;

    if (!query) return;

    const regex =
        new RegExp(
            escapeRegExp(query),
            "gi"
        );

    let count = 0;

    saveSnapshot();

    for (
        let row = 0;
        row < sheet.rows;
        row++
    ) {

        for (
            let col = 0;
            col < sheet.cols;
            col++
        ) {

            const cell =
                sheet.data[row][col];

            const oldValue =
                String(
                    cell.value ?? ""
                );

            const newValue =
                oldValue.replace(
                    regex,
                    replacement
                );

            if (
                oldValue !== newValue
            ) {

                cell.value =
                    newValue;

                count++;

            }

            regex.lastIndex = 0;

        }

    }

    markDirty();

    render();

    showToast(
        `${count} Zellen geändert`,
        "success"
    );

}


function escapeRegExp(
    value
) {

    return String(value)
        .replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );

}


/* =========================================================
   CSV
========================================================= */

function exportCSV() {

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    const rows = [];

    for (
        let row = 0;
        row < sheet.rows;
        row++
    ) {

        const values = [];

        for (
            let col = 0;
            col < sheet.cols;
            col++
        ) {

            values.push(
                calculateCell(
                    sheet,
                    row,
                    col
                )
            );

        }

        rows.push(values);

    }

    const csv =
        rows
            .map(
                row =>
                    row
                        .map(
                            csvEscape
                        )
                        .join(";")
            )
            .join("\r\n");

    downloadBlob(
        "\uFEFF" + csv,
        `${safeFileName(
            sheet.name
        )}.csv`,
        "text/csv;charset=utf-8"
    );

    showToast(
        "CSV exportiert",
        "success"
    );

}


function csvEscape(value) {

    const text =
        String(value ?? "");

    if (
        text.includes(";") ||
        text.includes('"') ||
        text.includes("\n") ||
        text.includes("\r")
    ) {

        return (
            '"' +
            text.replace(
                /"/g,
                '""'
            ) +
            '"'
        );

    }

    return text;

}


function parseCSV(text) {

    const rows = [];

    let row = [];
    let cell = "";
    let quoted = false;

    for (
        let i = 0;
        i < text.length;
        i++
    ) {

        const char =
            text[i];

        if (char === '"') {

            if (
                quoted &&
                text[i + 1] === '"'
            ) {

                cell += '"';

                i++;

            } else {

                quoted =
                    !quoted;

            }

        } else if (
            char === ";" &&
            !quoted
        ) {

            row.push(cell);

            cell = "";

        } else if (
            (
                char === "\n" ||
                char === "\r"
            ) &&
            !quoted
        ) {

            if (
                char === "\r" &&
                text[i + 1] === "\n"
            ) {

                i++;

            }

            row.push(cell);

            rows.push(row);

            row = [];
            cell = "";

        } else {

            cell += char;

        }

    }

    if (
        cell !== "" ||
        row.length
    ) {

        row.push(cell);

        rows.push(row);

    }

    return rows;

}


function importCSV(
    text,
    name = "Import"
) {

    const rows =
        parseCSV(text);

    if (!rows.length) {

        showToast(
            "CSV enthält keine Daten.",
            "error"
        );

        return;

    }

    const sheet =
        createSheet(
            name
        );

    const rowCount =
        clamp(
            rows.length,
            MIN_ROWS,
            MAX_ROWS
        );

    const maxColumns =
        rows.reduce(
            (
                max,
                row
            ) =>
                Math.max(
                    max,
                    row.length
                ),
            MIN_COLS
        );

    const colCount =
        clamp(
            maxColumns,
            MIN_COLS,
            MAX_COLS
        );

    ensureSheetDimensions(
        sheet,
        rowCount,
        colCount
    );

    for (
        let row = 0;
        row < rows.length &&
        row < MAX_ROWS;
        row++
    ) {

        for (
            let col = 0;
            col < rows[row].length &&
            col < MAX_COLS;
            col++
        ) {

            sheet.data[row][col].value =
                rows[row][col];

        }

    }

    state.sheets.push(
        sheet
    );

    state.activeSheetId =
        sheet.id;

    resetSelection();

    saveSnapshot();

    markDirty();

    render();

    showToast(
        "CSV importiert",
        "success"
    );

}


/* =========================================================
   XLSX
========================================================= */

function exportXLSX() {

    if (
        typeof XLSX ===
        "undefined"
    ) {

        showToast(
            "XLSX-Modul konnte nicht geladen werden.",
            "error"
        );

        return;

    }

    const workbook =
        XLSX.utils.book_new();

    for (
        const sheet of state.sheets
    ) {

        const aoa = [];

        for (
            let row = 0;
            row < sheet.rows;
            row++
        ) {

            const values = [];

            for (
                let col = 0;
                col < sheet.cols;
                col++
            ) {

                values.push(
                    calculateCell(
                        sheet,
                        row,
                        col
                    )
                );

            }

            aoa.push(values);

        }

        const ws =
            XLSX.utils.aoa_to_sheet(
                aoa
            );

        XLSX.utils.book_append_sheet(
            workbook,
            ws,
            sanitizeSheetName(
                sheet.name
            )
        );

    }

    XLSX.writeFile(
        workbook,
        `${safeFileName(
            state.workbookName
        )}.xlsx`,
        {
            compression: true
        }
    );

    showToast(
        "XLSX exportiert",
        "success"
    );

}


async function importXLSX(
    file
) {

    if (
        typeof XLSX ===
        "undefined"
    ) {

        showToast(
            "XLSX-Modul konnte nicht geladen werden.",
            "error"
        );

        return;

    }

    try {

        const buffer =
            await file.arrayBuffer();

        const workbook =
            XLSX.read(
                buffer,
                {
                    type: "array",
                    cellDates: true
                }
            );

        saveSnapshot();

        for (
            const sheetName of
            workbook.SheetNames
        ) {

            const ws =
                workbook.Sheets[
                    sheetName
                ];

            const aoa =
                XLSX.utils.sheet_to_json(
                    ws,
                    {
                        header: 1,
                        defval: ""
                    }
                );

            const sheet =
                createSheet(
                    sheetName
                );

            const rows =
                clamp(
                    Math.max(
                        MIN_ROWS,
                        aoa.length
                    ),
                    MIN_ROWS,
                    MAX_ROWS
                );

            const cols =
                clamp(
                    Math.max(
                        MIN_COLS,
                        ...aoa.map(
                            row =>
                                row.length
                        )
                    ),
                    MIN_COLS,
                    MAX_COLS
                );

            ensureSheetDimensions(
                sheet,
                rows,
                cols
            );

            for (
                let row = 0;
                row < aoa.length &&
                row < MAX_ROWS;
                row++
            ) {

                for (
                    let col = 0;
                    col < aoa[row].length &&
                    col < MAX_COLS;
                    col++
                ) {

                    const value =
                        aoa[row][col];

                    sheet.data[row][col]
                        .value =
                        value instanceof Date
                            ? value.toISOString()
                            : String(
                                value ?? ""
                            );

                }

            }

            state.sheets.push(
                sheet
            );

        }

        if (
            state.sheets.length
        ) {

            state.activeSheetId =
                state.sheets[
                    state.sheets.length - 1
                ].id;

        }

        resetSelection();

        markDirty();

        render();

        showToast(
            `${workbook.SheetNames.length} Tabellenblatt/Blätter importiert`,
            "success"
        );

    } catch (error) {

        console.error(error);

        showToast(
            "XLSX-Datei konnte nicht geöffnet werden.",
            "error"
        );

    }

}


/* =========================================================
   PDF
========================================================= */

function exportPDF() {

    if (
        !window.jspdf ||
        !window.jspdf.jsPDF
    ) {

        showToast(
            "PDF-Modul konnte nicht geladen werden.",
            "error"
        );

        return;

    }

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    try {

        const {
            jsPDF
        } =
            window.jspdf;

        const doc =
            new jsPDF({
                orientation:
                    "landscape",
                unit: "mm",
                format: "a4"
            });

        doc.setFontSize(16);

        doc.text(
            `${state.workbookName} – ${sheet.name}`,
            14,
            15
        );

        const head = [
            Array.from(
                {
                    length:
                        sheet.cols
                },
                (
                    _,
                    col
                ) =>
                    colToName(col)
            )
        ];

        const body = [];

        for (
            let row = 0;
            row < sheet.rows;
            row++
        ) {

            const values = [];

            for (
                let col = 0;
                col < sheet.cols;
                col++
            ) {

                values.push(
                    String(
                        formatDisplayValue(
                            calculateCell(
                                sheet,
                                row,
                                col
                            ),
                            sheet
                                .data[row][col]
                                .style
                                .numberFormat
                        )
                    )
                );

            }

            body.push(values);

        }

        if (
            typeof doc.autoTable !==
            "function"
        ) {

            showToast(
                "PDF-Tabellenmodul ist nicht verfügbar.",
                "error"
            );

            return;

        }

        doc.autoTable({

            head,

            body,

            startY: 22,

            theme: "grid",

            styles: {

                fontSize: 6,

                cellPadding: 1.5,

                overflow:
                    "linebreak"

            },

            headStyles: {

                fillColor:
                    [39, 64, 139],

                textColor: 255

            },

            alternateRowStyles: {

                fillColor:
                    [246, 248, 252]

            },

            margin: {

                left: 10,
                right: 10

            }

        });

        doc.save(
            `${safeFileName(
                sheet.name
            )}.pdf`
        );

        showToast(
            "PDF exportiert",
            "success"
        );

    } catch (error) {

        console.error(error);

        showToast(
            "PDF-Export fehlgeschlagen.",
            "error"
        );

    }

}


/* =========================================================
   PRINT
========================================================= */

function printSheet() {

    window.print();

}


/* =========================================================
   FILE IMPORT
========================================================= */

function openFilePicker() {

    els.fileInput.value = "";

    els.fileInput.click();

}


async function handleFile(
    file
) {

    if (!file) return;

    const lower =
        file.name.toLowerCase();

    if (
        lower.endsWith(".xlsx") ||
        lower.endsWith(".xls")
    ) {

        await importXLSX(
            file
        );

        return;

    }

    if (
        lower.endsWith(".csv") ||
        lower.endsWith(".txt")
    ) {

        try {

            const text =
                await file.text();

            importCSV(
                text,
                file.name.replace(
                    /\.[^.]+$/,
                    ""
                )
            );

        } catch (error) {

            console.error(error);

            showToast(
                "Datei konnte nicht gelesen werden.",
                "error"
            );

        }

        return;

    }

    showToast(
        "Nicht unterstütztes Dateiformat.",
        "error"
    );

}


/* =========================================================
   NEW WORKBOOK
========================================================= */

function newWorkbook() {

    if (
        state.dirty &&
        !confirm(
            "Es gibt ungespeicherte Änderungen. Neue Arbeitsmappe erstellen?"
        )
    ) {

        return;

    }

    createNewWorkbook(true);

    render();

    saveLocal();

    showToast(
        "Neue Arbeitsmappe erstellt",
        "success"
    );

}


/* =========================================================
   DEMO DATA
========================================================= */

function loadDemo() {

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    saveSnapshot();

    const demo = [

        [
            "Produkt",
            "Kategorie",
            "Menge",
            "Preis",
            "Umsatz",
            "Status"
        ],

        [
            "Notater Pad",
            "Hardware",
            12,
            49.90,
            "=C2*D2",
            "Aktiv"
        ],

        [
            "Notater Cloud",
            "Software",
            25,
            9.99,
            "=C3*D3",
            "Aktiv"
        ],

        [
            "Notater Bold",
            "Office",
            42,
            19.90,
            "=C4*D4",
            "Neu"
        ],

        [
            "Notater Mail",
            "Kommunikation",
            18,
            14.90,
            "=C5*D5",
            "Aktiv"
        ],

        [
            "Notater Drive",
            "Cloud",
            31,
            7.50,
            "=C6*D6",
            "Beta"
        ],

        [
            "Gesamt",
            "",
            "=SUM(C2:C6)",
            "",
            "=SUM(E2:E6)",
            ""
        ]

    ];

    ensureSheetDimensions(
        sheet,
        Math.max(
            DEFAULT_ROWS,
            demo.length + 5
        ),
        Math.max(
            DEFAULT_COLS,
            demo[0].length + 5
        )
    );

    for (
        let row = 0;
        row < demo.length;
        row++
    ) {

        for (
            let col = 0;
            col < demo[row].length;
            col++
        ) {

            sheet.data[row][col]
                .value =
                demo[row][col];

        }

    }

    for (
        const cell of sheet.data[0]
    ) {

        cell.style.bold =
            true;

        cell.style.background =
            "#eef1f8";

    }

    for (
        let row = 1;
        row <= 6;
        row++
    ) {

        sheet.data[row][3]
            .style.numberFormat =
            "currency";

        sheet.data[row][4]
            .style.numberFormat =
            "currency";

    }

    sheet.data[6][4]
        .style.bold =
        true;

    sheet.data[6][4]
        .style.background =
        "#e9f7ef";

    markDirty();

    render();

    showToast(
        "Demo-Daten geladen",
        "success"
    );

}


/* =========================================================
   FREEZE
========================================================= */

function toggleFreeze() {

    state.freezeHeader =
        !state.freezeHeader;

    els.freezeBtn.classList.toggle(
        "primary",
        state.freezeHeader
    );

    applyFreezeState();

    showToast(
        state.freezeHeader
            ? "Kopfzeile fixiert"
            : "Fixierung aufgehoben",
        "info"
    );

}


/* =========================================================
   ZOOM
========================================================= */

function setZoom(
    value
) {

    state.zoom =
        clamp(
            value,
            0.6,
            2
        );

    els.spreadsheet.style.transform =
        `scale(${state.zoom})`;

    els.spreadsheet.style.transformOrigin =
        "top left";

    updateZoom();

}


function updateZoom() {

    const percentage =
        Math.round(
            state.zoom * 100
        );

    els.zoomValue.textContent =
        `${percentage}%`;

}


/* =========================================================
   FULLSCREEN
========================================================= */

async function toggleFullscreen() {

    try {

        if (
            !document.fullscreenElement
        ) {

            await document.documentElement
                .requestFullscreen();

        } else {

            await document.exitFullscreen();

        }

    } catch (error) {

        console.error(error);

    }

}


/* =========================================================
   THEMES
========================================================= */

function setTheme(
    theme
) {

    document.body.classList.remove(
        "theme-moerk",
        "theme-neon",
        "theme-skog",
        "theme-hav",
        "theme-pergament"
    );

    if (
        theme !== "default"
    ) {

        document.body.classList.add(
            `theme-${theme}`
        );

    }

    try {

        localStorage.setItem(
            THEME_KEY,
            theme
        );

    } catch (_) {}

    if (els.themeMenu) {

        els.themeMenu.classList.add(
            "hidden"
        );

    }

}


function loadTheme() {

    let theme =
        "default";

    try {

        theme =
            localStorage.getItem(
                THEME_KEY
            ) ||
            "default";

    } catch (_) {}

    setTheme(
        theme
    );

}


/* =========================================================
   STATUS
========================================================= */

function updateStatus() {

    const cell =
        getCell(
            state.selectedRow,
            state.selectedCol
        );

    if (!cell) return;

    const address =
        cellAddress(
            state.selectedRow,
            state.selectedCol
        );

    els.cellStatus.textContent =
        address;

    const value =
        calculateCell(
            getActiveSheet(),
            state.selectedRow,
            state.selectedCol
        );

    els.selectionStatus.textContent =
        value === ""
            ? "Leer"
            : `Wert: ${String(
                value
            ).slice(0, 80)}`;

    els.calcStatus.textContent =
        "Berechnung abgeschlossen";

}


/* =========================================================
   KEYBOARD
========================================================= */

function handleKeyboard(
    event
) {

    if (
        event.target ===
            els.formulaInput ||
        event.target ===
            els.searchInput ||
        event.target ===
            els.replaceInput
    ) {

        return;

    }

    if (
        event.target ===
        els.workbookName
    ) {

        if (
            event.ctrlKey &&
            event.key.toLowerCase() === "s"
        ) {

            event.preventDefault();

            saveLocal();

        }

        return;

    }

    if (state.editing) return;

    const sheet =
        getActiveSheet();

    if (!sheet) return;


    /* Undo */

    if (
        event.ctrlKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "z"
    ) {

        event.preventDefault();

        undo();

        return;

    }


    /* Redo */

    if (
        (
            event.ctrlKey &&
            event.key.toLowerCase() === "y"
        ) ||
        (
            event.ctrlKey &&
            event.shiftKey &&
            event.key.toLowerCase() === "z"
        )
    ) {

        event.preventDefault();

        redo();

        return;

    }


    /* Save */

    if (
        event.ctrlKey &&
        event.key.toLowerCase() === "s"
    ) {

        event.preventDefault();

        saveLocal();

        showToast(
            "Arbeitsmappe gespeichert",
            "success"
        );

        return;

    }


    /* Copy */

    if (
        event.ctrlKey &&
        event.key.toLowerCase() === "c"
    ) {

        event.preventDefault();

        copySelectedCells();

        return;

    }


    /* Cut */

    if (
        event.ctrlKey &&
        event.key.toLowerCase() === "x"
    ) {

        event.preventDefault();

        cutSelectedCells();

        return;

    }


    /* Paste */

    if (
        event.ctrlKey &&
        event.key.toLowerCase() === "v"
    ) {

        event.preventDefault();

        pasteSelectedCells();

        return;

    }


    /* Search */

    if (
        event.ctrlKey &&
        event.key.toLowerCase() === "f"
    ) {

        event.preventDefault();

        openSearch();

        return;

    }


    /* Bold */

    if (
        event.ctrlKey &&
        event.key.toLowerCase() === "b"
    ) {

        event.preventDefault();

        toggleBold();

        return;

    }


    /* Italic */

    if (
        event.ctrlKey &&
        event.key.toLowerCase() === "i"
    ) {

        event.preventDefault();

        toggleItalic();

        return;

    }


    /* F2 */

    if (
        event.key === "F2"
    ) {

        event.preventDefault();

        beginEdit(
            state.selectedRow,
            state.selectedCol
        );

        return;

    }


    /* Delete */

    if (
        event.key === "Delete"
    ) {

        event.preventDefault();

        clearSelectedCells();

        return;

    }


    /* Enter */

    if (
        event.key === "Enter"
    ) {

        event.preventDefault();

        beginEdit(
            state.selectedRow,
            state.selectedCol
        );

        return;

    }


    /* Arrow keys */

    if (
        event.key === "ArrowUp"
    ) {

        event.preventDefault();

        selectCell(
            state.selectedRow - 1,
            state.selectedCol,
            event.shiftKey
        );

    }


    if (
        event.key === "ArrowDown"
    ) {

        event.preventDefault();

        selectCell(
            state.selectedRow + 1,
            state.selectedCol,
            event.shiftKey
        );

    }


    if (
        event.key === "ArrowLeft"
    ) {

        event.preventDefault();

        selectCell(
            state.selectedRow,
            state.selectedCol - 1,
            event.shiftKey
        );

    }


    if (
        event.key === "ArrowRight"
    ) {

        event.preventDefault();

        selectCell(
            state.selectedRow,
            state.selectedCol + 1,
            event.shiftKey
        );

    }


    /* Tab */

    if (
        event.key === "Tab"
    ) {

        event.preventDefault();

        selectCell(
            state.selectedRow,
            state.selectedCol +
                (
                    event.shiftKey
                        ? -1
                        : 1
                ),
            false
        );

    }

}


function clearSelectedCells() {

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    const cells =
        getSelectedCells();

    if (!cells.length) return;

    const hasContent =
        cells.some(
            ({ row, col }) =>
                sheet.data[row][col]
                    .value !== ""
        );

    if (!hasContent) return;

    saveSnapshot();

    for (
        const { row, col } of cells
    ) {

        sheet.data[row][col]
            .value = "";

    }

    markDirty();

    render();

}


/* =========================================================
   HEADER SELECTION
========================================================= */

function selectColumn(
    col,
    extend = false
) {

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    if (extend) {

        setSelection(
            state.anchorRow,
            state.anchorCol,
            sheet.rows - 1,
            col
        );

    } else {

        state.anchorRow = 0;
        state.anchorCol = col;

        setSelection(
            0,
            col,
            sheet.rows - 1,
            col
        );

    }

    renderGrid();
    updateStatus();

}


function selectRow(
    row,
    extend = false
) {

    const sheet =
        getActiveSheet();

    if (!sheet) return;

    if (extend) {

        setSelection(
            state.anchorRow,
            state.anchorCol,
            row,
            sheet.cols - 1
        );

    } else {

        state.anchorRow = row;
        state.anchorCol = 0;

        setSelection(
            row,
            0,
            row,
            sheet.cols - 1
        );

    }

    renderGrid();
    updateStatus();

}


/* =========================================================
   SCROLL
========================================================= */

function scrollCellIntoView(
    row,
    col
) {

    const td =
        els.sheetBody.querySelector(
            `td[data-row="${row}"][data-col="${col}"]`
        );

    if (!td) return;

    td.scrollIntoView({
        block: "nearest",
        inline: "nearest"
    });

}


/* =========================================================
   DOWNLOAD
========================================================= */

function downloadBlob(
    content,
    fileName,
    type
) {

    const blob =
        new Blob(
            [content],
            { type }
        );

    const url =
        URL.createObjectURL(
            blob
        );

    const link =
        document.createElement("a");

    link.href =
        url;

    link.download =
        fileName;

    document.body.appendChild(
        link
    );

    link.click();

    link.remove();

    setTimeout(
        () =>
            URL.revokeObjectURL(
                url
            ),
        1000
    );

}


/* =========================================================
   SHEET NAME
========================================================= */

function sanitizeSheetName(
    name
) {

    const cleaned =
        String(
            name ||
            "Tabelle"
        )
            .replace(
                /[:\\/?*\[\]]/g,
                "_"
            )
            .trim()
            .slice(0, 31);

    return (
        cleaned ||
        "Tabelle"
    );

}


/* =========================================================
   EVENTS
========================================================= */

function bindEvents() {

    /* Workbook */

    els.newBtn.addEventListener(
        "click",
        newWorkbook
    );

    els.openBtn.addEventListener(
        "click",
        openFilePicker
    );

    els.saveBtn.addEventListener(
        "click",
        exportXLSX
    );

    els.csvExportBtn.addEventListener(
        "click",
        exportCSV
    );

    els.pdfBtn.addEventListener(
        "click",
        exportPDF
    );

    els.printBtn.addEventListener(
        "click",
        printSheet
    );


    /* History */

    els.undoBtn.addEventListener(
        "click",
        undo
    );

    els.redoBtn.addEventListener(
        "click",
        redo
    );


    /* Formatting */

    els.boldBtn.addEventListener(
        "click",
        toggleBold
    );

    els.italicBtn.addEventListener(
        "click",
        toggleItalic
    );

    els.textColor.addEventListener(
        "input",
        event =>
            changeTextColor(
                event.target.value
            )
    );

    els.fillColor.addEventListener(
        "input",
        event =>
            changeFillColor(
                event.target.value
            )
    );

    els.numberFormat.addEventListener(
        "change",
        event =>
            changeNumberFormat(
                event.target.value
            )
    );


    /* Rows / columns */

    els.insertRowBtn.addEventListener(
        "click",
        insertRow
    );

    els.insertColBtn.addEventListener(
        "click",
        insertColumn
    );

    els.deleteRowBtn.addEventListener(
        "click",
        deleteRow
    );

    els.deleteColBtn.addEventListener(
        "click",
        deleteColumn
    );


    /* Sheet */

    els.addSheetBtn.addEventListener(
        "click",
        addSheet
    );


    /* Formula */

    els.formulaApply.addEventListener(
        "click",
        applyFormulaBar
    );

    els.formulaCancel.addEventListener(
        "click",
        cancelFormulaBar
    );

    els.formulaInput.addEventListener(
        "keydown",
        event => {

            if (
                event.key === "Enter"
            ) {

                event.preventDefault();

                applyFormulaBar();

            }

            if (
                event.key === "Escape"
            ) {

                event.preventDefault();

                cancelFormulaBar();

            }

        }
    );


    /* Workbook name */

    els.workbookName.addEventListener(
        "input",
        event => {

            state.workbookName =
                event.target.value
                    .trim()
                    .slice(0, 120) ||
                "Meine Arbeitsmappe";

            markDirty();

        }
    );


    /* Search */

    els.searchBtn.addEventListener(
        "click",
        openSearch
    );

    els.closeSearchBtn.addEventListener(
        "click",
        closeSearch
    );

    els.findNextBtn.addEventListener(
        "click",
        performSearch
    );

    els.replaceBtn.addEventListener(
        "click",
        replaceSelected
    );

    els.replaceAllBtn.addEventListener(
        "click",
        replaceAll
    );

    els.searchInput.addEventListener(
        "input",
        () => {

            state.searchResults = [];
            state.searchIndex = -1;

            clearSearchHighlights();

        }
    );

    els.searchInput.addEventListener(
        "keydown",
        event => {

            if (
                event.key === "Enter"
            ) {

                event.preventDefault();

                performSearch();

            }

            if (
                event.key === "Escape"
            ) {

                closeSearch();

            }

        }
    );


    /* Freeze */

    els.freezeBtn.addEventListener(
        "click",
        toggleFreeze
    );


    /* Demo */

    els.demoBtn.addEventListener(
        "click",
        loadDemo
    );


    /* Fullscreen */

    els.fullscreenBtn.addEventListener(
        "click",
        toggleFullscreen
    );


    /* Theme */

    els.themeButton.addEventListener(
        "click",
        event => {

            event.stopPropagation();

            els.themeMenu.classList.toggle(
                "hidden"
            );

        }
    );

    els.themeMenu
        .querySelectorAll(
            "[data-theme]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () =>
                        setTheme(
                            button.dataset.theme
                        )
                );

            }
        );

    document.addEventListener(
        "click",
        event => {

            if (
                !els.themeMenu.contains(
                    event.target
                ) &&
                event.target !==
                    els.themeButton
            ) {

                els.themeMenu.classList.add(
                    "hidden"
                );

            }

        }
    );


    /* Zoom */

    els.zoomOut.addEventListener(
        "click",
        () =>
            setZoom(
                state.zoom - 0.1
            )
    );

    els.zoomIn.addEventListener(
        "click",
        () =>
            setZoom(
                state.zoom + 0.1
            )
    );

    els.zoomReset.addEventListener(
        "click",
        () =>
            setZoom(1)
    );


    /* File */

    els.fileInput.addEventListener(
        "change",
        async event => {

            const file =
                event.target.files?.[0];

            if (!file) return;

            await handleFile(file);

            event.target.value = "";

        }
    );


    /* Keyboard */

    document.addEventListener(
        "keydown",
        handleKeyboard
    );


    /* Column headers */

    els.sheetHead.addEventListener(
        "click",
        event => {

            const header =
                event.target.closest(
                    ".col-header"
                );

            if (!header) return;

            selectColumn(
                Number(
                    header.dataset.col
                ),
                event.shiftKey
            );

        }
    );


    /* Row headers */

    els.sheetBody.addEventListener(
        "click",
        event => {

            const header =
                event.target.closest(
                    ".row-header"
                );

            if (!header) return;

            selectRow(
                Number(
                    header.dataset.row
                ),
                event.shiftKey
            );

        }
    );


    /* Corner = select all */

    els.sheetHead.addEventListener(
        "click",
        event => {

            if (
                !event.target.classList
                    .contains("corner")
            ) {

                return;

            }

            const sheet =
                getActiveSheet();

            if (!sheet) return;

            state.anchorRow = 0;
            state.anchorCol = 0;

            setSelection(
                0,
                0,
                sheet.rows - 1,
                sheet.cols - 1
            );

            renderGrid();

            updateStatus();

        }
    );


    /* Drag & drop */

    els.sheetViewport.addEventListener(
        "dragover",
        event => {

            event.preventDefault();

            els.sheetViewport.classList.add(
                "drag-over"
            );

        }
    );

    els.sheetViewport.addEventListener(
        "dragleave",
        () => {

            els.sheetViewport.classList.remove(
                "drag-over"
            );

        }
    );

    els.sheetViewport.addEventListener(
        "drop",
        async event => {

            event.preventDefault();

            els.sheetViewport.classList.remove(
                "drag-over"
            );

            const file =
                event.dataTransfer
                    .files?.[0];

            if (!file) return;

            await handleFile(
                file
            );

        }
    );


    /* Before unload */

    window.addEventListener(
        "beforeunload",
        () => {

            if (state.dirty) {

                saveLocal();

            }

        }
    );


    /* Resize */

    window.addEventListener(
        "resize",
        applyFreezeState
    );

}