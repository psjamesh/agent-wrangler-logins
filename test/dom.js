export function dom() {
  const doc = { createElement(tag) {
    const el = { tagName: tag.toUpperCase(), ownerDocument: doc, children: [], dataset: {}, value: '', className: '', _text: '', listeners: {},
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      append(...cs) { cs.forEach((c) => this.appendChild(c)); },
      replaceChildren(...cs) { this.children = []; this._text = ''; this.append(...cs); },
      removeChild(c) { this.children.splice(this.children.indexOf(c), 1); c.parentNode = null; },
      addEventListener(name, cb) { this.listeners[name] = cb; },
      setAttribute(name, value) { this[name] = value; },
      set textContent(v) { this._text = v; this.children = []; },
      get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
    }; return el;
  } }; return doc;
}
