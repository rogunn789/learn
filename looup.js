(function () {
  /*****************************************************************
   * 1. 动态注入 CSS 样式
   *****************************************************************/
  const style = document.createElement('style');
  style.textContent = `
    /* 浮动控制按钮样式（支持拖拽） */
    .yomitan-toggle-btn {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 10000;
      padding: 10px 16px;
      font-size: 14px;
      font-weight: bold;
      border: none;
      border-radius: 50px;
      cursor: grab;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transition: background-color 0.3s ease, box-shadow 0.3s ease;
      color: #fff;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
    }
    .yomitan-toggle-btn:active {
      cursor: grabbing;
    }
    .yomitan-toggle-btn.enabled {
      background-color: #22c55e;
    }
    .yomitan-toggle-btn.disabled {
      background-color: #ef4444;
    }

    /* 浮动释义弹窗 */
    .dict-popover {
      position: absolute;
      z-index: 9999;
      width: 320px;
      max-height: 320px;
      overflow-y: auto;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      padding: 14px;
      font-size: 14px;
      display: none;
      color: #334155;
      font-family: "Zen Old Mincho", "MS PGothic", "Hiragino Sans", -apple-system, sans-serif;
    }

    .dict-entry { margin-bottom: 12px; }
    .dict-entry:last-child { margin-bottom: 0; }
    .dict-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 4px;
      margin-bottom: 6px;
    }
    .dict-term { font-size: 16px; font-weight: bold; color: #0f172a; }
    .dict-reading { font-size: 13px; color: #64748b; }
    .dict-glossary { margin: 0; padding-left: 20px; color: #334155; }
    .dict-glossary li { margin-bottom: 4px; }
    .dict-raw-def { color: #334155; font-size: 13px; }
    .dict-divider { border: none; border-top: 1px dashed #e2e8f0; margin: 10px 0; }
    span[data-class="word"], div[data-class="word"],
    span[data-class="phrase"], div[data-class="phrase"] { font-weight: bold; font-size: 1.1em; }
    span[data-class="type"], div[data-class="type"] { color: OrangeRed; font-weight: bold; }
    span[data-class="dfcn"], div[data-class="dfcn"] { color: DodgerBlue; }
    span[data-class="exjp"], div[data-class="exjp"] { color: darkgreen; }
    span[data-class="excn"], div[data-class="excn"] { color: LimeGreen; }
  `;
  document.head.appendChild(style);

  /*****************************************************************
   * 2. 获取 URL 中的密码参数
   *****************************************************************/
  const urlParams = new URLSearchParams(window.location.search);
  const DICT_PASSWORD = urlParams.get('pwd') || urlParams.get('password') || urlParams.get('pawd') || '';
  const DICT_URL = "https://rogunn789.github.io/learn/mj155.zip";

  let isEnabled = true; // 翻译功能生效状态标志

  /*****************************************************************
   * 3. IndexedDB 管理与解密核心
   *****************************************************************/
  let dbPromise = null;

  function getDB(dbName = "DictDB") {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains("terms")) {
            const termStore = db.createObjectStore("terms", { autoIncrement: true });
            termStore.createIndex("expression", "expression", { unique: false });
            termStore.createIndex("reading", "reading", { unique: false });
          }
          if (!db.objectStoreNames.contains("kanji")) {
            db.createObjectStore("kanji", { keyPath: "kanji" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return dbPromise;
  }

  async function hasCachedData() {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction("terms", "readonly");
      const countReq = tx.objectStore("terms").count();
      countReq.onsuccess = () => resolve(countReq.result > 0);
      countReq.onerror = () => resolve(false);
    });
  }

  function unzipAsync(zipUint8) {
    return new Promise((resolve, reject) => {
      fflate.unzip(zipUint8, (err, unzippedData) => {
        if (err) reject(err);
        else resolve(unzippedData);
      });
    });
  }

  async function decryptZipBuffer(encryptedData, password) {
    const dataView = new Uint8Array(encryptedData);
    if (dataView.length < 28) throw new Error("下载的文件损坏或体积过小");

    const salt = dataView.slice(0, 16);
    const iv = dataView.slice(16, 28);
    const ciphertext = dataView.slice(28);

    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
      "raw", encoder.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
    );

    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
      passwordKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );

    return await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ciphertext);
  }

  async function loadDictionaryFromURL(url) {
    if (!DICT_PASSWORD) {
      console.warn("YomitanDict: 未在 URL 中发现密码参数 (pwd 或 password)");
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP 错误: ${response.status}`);
    
    const encryptedBuffer = await response.arrayBuffer();
    const decryptedBuffer = await decryptZipBuffer(encryptedBuffer, DICT_PASSWORD);
    const zipUint8 = new Uint8Array(decryptedBuffer);
    
    const unzipped = await unzipAsync(zipUint8);
    const db = await getDB();

    const indexFileUint8 = unzipped["index.json"];
    if (!indexFileUint8) throw new Error("缺少 index.json");

    const indexData = JSON.parse(fflate.strFromU8(indexFileUint8));
    const termFiles = Object.keys(unzipped).filter(name => /^term_bank_\d+\.json$/.test(name));

    for (const fileName of termFiles) {
      const termEntries = JSON.parse(fflate.strFromU8(unzipped[fileName]));
      await new Promise((resolve, reject) => {
        const tx = db.transaction("terms", "readwrite");
        const store = tx.objectStore("terms");
        for (const entry of termEntries) {
          const [expression, reading, definitionTags, rules, score, glossary, sequence, termTags] = entry;
          store.add({ expression, reading: reading || expression, definitionTags, rules, score, glossary, sequence, termTags });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    console.log(`字典【${indexData.title}】加载成功！`);
  }

  async function initDictionary() {
    try {
      const isCached = await hasCachedData();
      if (!isCached) {
        await loadDictionaryFromURL(DICT_URL);
      }
    } catch (err) {
      console.error("字典初始化或解密失败:", err);
    }
  }

  /*****************************************************************
   * 4. 词条查询与词形还原 (De-inflection)
   *****************************************************************/
  async function queryExactTerm(keyword) {
    if (!keyword || !keyword.trim()) return [];
    const db = await getDB();
    const cleanKey = keyword.trim();

    return new Promise((resolve, reject) => {
      const tx = db.transaction("terms", "readonly");
      const store = tx.objectStore("terms");
      const exprIndex = store.index("expression");
      const readIndex = store.index("reading");

      const reqExpr = exprIndex.getAll(cleanKey);
      const reqRead = readIndex.getAll(cleanKey);

      let exprResults = [], readResults = [], completed = 0;

      const checkDone = () => {
        completed++;
        if (completed === 2) {
          const combined = [...exprResults, ...readResults];
          const uniqueMap = new Map();
          combined.forEach(item => {
            const key = `${item.expression}_${item.reading}_${JSON.stringify(item.glossary)}`;
            if (!uniqueMap.has(key)) uniqueMap.set(key, item);
          });
          resolve(Array.from(uniqueMap.values()).sort((a, b) => (b.score || 0) - (a.score || 0)));
        }
      };

      reqExpr.onsuccess = () => { exprResults = reqExpr.result; checkDone(); };
      reqRead.onsuccess = () => { readResults = reqRead.result; checkDone(); };
      reqExpr.onerror = () => reject(reqExpr.error);
      reqRead.onerror = () => reject(readIndex.error);
    });
  }

  async function searchWithBackoff(rawText) {
    let targetWord = rawText.length > 12 ? rawText.substring(0, 12) : rawText;

    const deinflectRules = [
      { suffix: 'れた', replacements: ['れる', 'まれる'] },
      { suffix: 'れて', replacements: ['れる', 'まれる'] },
      { suffix: 'れない', replacements: ['れる', 'まれる'] },
      { suffix: 'れる', replacements: ['まれる'] },
      { suffix: 'させられる', replacements: ['す'] },
      { suffix: 'られる', replacements: ['る'] },
      { suffix: 'させる', replacements: ['す'] },
      { suffix: 'される', replacements: ['す', 'する'] },
      { suffix: 'かったら', replacements: ['い'] },
      { suffix: 'くない', replacements: ['い'] },
      { suffix: 'かった', replacements: ['い'] },
      { suffix: 'ました', replacements: ['る', 'す'] },
      { suffix: 'ません', replacements: ['る', 'す'] },
      { suffix: 'ます', replacements: ['る'] },
      { suffix: 'った', replacements: ['う', 'つ', 'る'] },
      { suffix: 'って', replacements: ['う', 'つ', 'る'] },
      { suffix: 'んだ', replacements: ['む', 'ぶ', 'ぬ'] },
      { suffix: 'んで', replacements: ['む', 'ぶ', 'ぬ'] },
      { suffix: 'した', replacements: ['す', 'する'] },
      { suffix: 'して', replacements: ['す', 'する'] },
      { suffix: 'いた', replacements: ['く'] },
      { suffix: 'いて', replacements: ['く'] },
      { suffix: 'ない', replacements: ['る'] },
      { suffix: 'た', replacements: ['る', ''] },
      { suffix: 'て', replacements: ['る', ''] }
    ];

    while (targetWord.length > 0) {
      let results = await queryExactTerm(targetWord);
      if (results && results.length > 0) return { word: targetWord, results };

      for (const rule of deinflectRules) {
        if (targetWord.endsWith(rule.suffix)) {
          const base = targetWord.slice(0, -rule.suffix.length);
          for (const rep of rule.replacements) {
            results = await queryExactTerm(base + rep);
            if (results && results.length > 0) return { word: base + rep, results };
          }
        }
      }
      targetWord = targetWord.slice(0, -1);
    }
    return null;
  }

  /*****************************************************************
   * 5. UI 弹窗与事件触发（PC & 移动端拖拽兼容增强）
   *****************************************************************/
  let popover = null;

  /**
   * 给元素绑定 PC 鼠标及移动端触摸拖拽逻辑
   */
  function makeElementDraggable(el) {
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;
    let isDragging = false;
    let hasMoved = false;

    const onStart = (e) => {
      // 仅响应鼠标左键或触摸事件
      if (e.type === 'mousedown' && e.button !== 0) return;

      const touch = e.touches ? e.touches[0] : e;
      startX = touch.clientX;
      startY = touch.clientY;

      const rect = el.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      isDragging = true;
      hasMoved = false;

      if (e.type === 'mousedown') {
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);
      } else if (e.type === 'touchstart') {
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
      }
    };

    const onMove = (e) => {
      if (!isDragging) return;

      const touch = e.touches ? e.touches[0] : e;
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;

      // 移动位移大于 5px 时判定为真正拖拽动作
      if (Math.hypot(deltaX, deltaY) > 5) {
        hasMoved = true;
      }

      if (hasMoved) {
        if (e.cancelable) e.preventDefault();

        let newLeft = initialLeft + deltaX;
        let newTop = initialTop + deltaY;

        // 视口边界碰撞检测，防止拖出屏幕外
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        const elWidth = el.offsetWidth;
        const elHeight = el.offsetHeight;

        newLeft = Math.max(10, Math.min(winWidth - elWidth - 10, newLeft));
        newTop = Math.max(10, Math.min(winHeight - elHeight - 10, newTop));

        el.style.left = `${newLeft}px`;
        el.style.top = `${newTop}px`;
        el.style.bottom = 'auto';
        el.style.right = 'auto';
      }
    };

    const onEnd = () => {
      isDragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };

    el.addEventListener('mousedown', onStart);
    el.addEventListener('touchstart', onStart, { passive: false });

    // 捕获阶段拦截点击事件：如果刚才发生了拖拽，阻止触发按钮的 click 事件
    el.addEventListener('click', (e) => {
      if (hasMoved) {
        e.stopPropagation();
        e.preventDefault();
        hasMoved = false;
      }
    }, true);
  }

  function createUI() {
    popover = document.createElement('div');
    popover.className = 'dict-popover';
    document.body.appendChild(popover);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'yomitan-toggle-btn enabled';
    toggleBtn.innerText = '划词翻译：开启';
    document.body.appendChild(toggleBtn);

    // 绑定拖拽逻辑
    makeElementDraggable(toggleBtn);

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isEnabled = !isEnabled;
      if (isEnabled) {
        toggleBtn.innerText = '划词翻译：开启';
        toggleBtn.className = 'yomitan-toggle-btn enabled';
      } else {
        toggleBtn.innerText = '划词翻译：关闭';
        toggleBtn.className = 'yomitan-toggle-btn disabled';
        popover.style.display = 'none';
      }
    });

    document.addEventListener('click', (e) => {
      if (popover && !popover.contains(e.target) && e.target !== toggleBtn) {
        popover.style.display = 'none';
      }
    });

    // 核心处理函数
// 核心处理函数
    const handleLookup = async (e) => {
      // 检查点击的元素本身或其祖先元素是否是 class 包含 looupwrap 的 div
      // 如果不是，则直接返回，不触发划词搜索
      if (!e.target.closest('div[class*="looupwrap"]')) return;

      if (!isEnabled || e.target === toggleBtn || popover.contains(e.target)) return;

      const targetText = getTextFromClickPosition(e);
      if (!targetText) return;

      const matchResult = await searchWithBackoff(targetText);
      if (matchResult && matchResult.results.length > 0) {
        renderPopover(
          matchResult.results, 
          e.pageX || (e.changedTouches ? e.changedTouches[0].pageX : 0), 
          e.pageY || (e.changedTouches ? e.changedTouches[0].pageY : 0)
        );
      }
    };

    // 支持 PC 鼠标松开 (mouseup) 与 移动端点击 (click)
    document.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      handleLookup(e);
    });
  }

  /**
   * 优化后的 PC/移动端光标位置文本提取
   */
  function getTextFromClickPosition(e) {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    if (selectedText) return selectedText;

    let clientX = e.clientX, clientY = e.clientY;
    if (e.changedTouches && e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    }

    let textNode = null, offset = 0;

    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(clientX, clientY);
      if (range) {
        textNode = range.startContainer;
        offset = range.startOffset;
      }
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(clientX, clientY);
      if (pos) {
        textNode = pos.offsetNode;
        offset = pos.offset;
      }
    }

    if (textNode && textNode.nodeType !== Node.TEXT_NODE) {
      if (textNode.childNodes.length > 0) {
        let child = textNode.childNodes[offset] || textNode.childNodes[0];
        while (child && child.nodeType !== Node.TEXT_NODE && child.childNodes.length > 0) {
          child = child.childNodes[0];
        }
        if (child && child.nodeType === Node.TEXT_NODE) {
          textNode = child;
          offset = 0;
        }
      }
    }

    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      const fullText = textNode.data;
      const startPos = Math.max(0, offset > 0 ? offset - 1 : 0);
      return fullText.substring(startPos, startPos + 12).trim();
    }

    return "";
  }

  function parseStructuredContent(node) {
    if (node === null || node === undefined) return '';
    if (typeof node !== 'object') return String(node);
    if (Array.isArray(node)) return node.map(parseStructuredContent).join('');
    if (node.type === 'structured-content') return parseStructuredContent(node.content);

    if (node.tag) {
      const tag = node.tag;
      if (tag === 'img') return `<img src="${node.path || node.src || ''}" alt="${node.alt || ''}" />`;
      let attrs = '';
      if (node.style) {
        attrs += typeof node.style === 'object'
          ? ' style="' + Object.entries(node.style).map(([k, v]) => `${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}:${v}`).join(';') + '"'
          : ` style="${node.style}"`;
      }
      if (node.class) attrs += ` class="${node.class}"`;
      if (node.data) {
        for (const [k, v] of Object.entries(node.data)) attrs += ` data-${k}="${v}"`;
      }
      return `<${tag}${attrs}>${parseStructuredContent(node.content)}</${tag}>`;
    }
    if (node.content !== undefined) return parseStructuredContent(node.content);
    if (node.text !== undefined) return parseStructuredContent(node.text);
    return String(node);
  }

  function renderGlossary(glossary) {
    if (!glossary) return '<div class="dict-raw-def">（未检索到有效释义）</div>';
    if (typeof glossary === 'object' && !Array.isArray(glossary)) return `<div class="dict-raw-def">${parseStructuredContent(glossary)}</div>`;
    if (Array.isArray(glossary)) {
      return `<ol class="dict-glossary">${glossary.map(item => `<li>${parseStructuredContent(item)}</li>`).join('')}</ol>`;
    }
    return `<div class="dict-raw-def">${parseStructuredContent(glossary)}</div>`;
  }

  function renderPopover(results, pageX, pageY) {
    const html = results.slice(0, 4).map((item, idx) => `
      <div class="dict-entry">
        <div class="dict-header">
          <span class="dict-term">${item.expression}</span>
          ${item.reading !== item.expression ? `<span class="dict-reading">[${item.reading}]</span>` : ''}
        </div>
        ${renderGlossary(item.glossary)}
      </div>
      ${idx < Math.min(results.length, 4) - 1 ? '<hr class="dict-divider"/>' : ''}
    `).join('');

    popover.innerHTML = html;
    popover.style.display = 'block';

    const popRect = popover.getBoundingClientRect();
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;

    let left = pageX + 10;
    let top = pageY + 15;

    if (left + popRect.width > winWidth - 10) left = winWidth - popRect.width - 10;
    if (top - window.scrollY + popRect.height > winHeight - 10) top = pageY - popRect.height - 15;

    popover.style.left = `${Math.max(10, left)}px`;
    popover.style.top = `${Math.max(10, top)}px`;
  }

  /*****************************************************************
   * 6. 初始化入口
   *****************************************************************/
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      createUI();
      initDictionary();
    });
  } else {
    createUI();
    initDictionary();
  }
})();