/** Browser entry point: inject the compiled stylesheet, then mount the app. */
import { createRoot } from "react-dom/client";

import { App } from "./app.js";
import { initTheme } from "./theme.js";

const style = document.createElement("style");
style.textContent = __APP_CSS__;
document.head.append(style);

initTheme();

const rootElement = document.getElementById("app");
if (rootElement !== null) {
  rootElement.replaceChildren();
  createRoot(rootElement).render(<App />);
}
