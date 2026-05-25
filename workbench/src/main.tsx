import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import App from "./App";
import { useStore } from "./store";
import { hydrateSettingsFromFile } from "./store/settingsSlice";

async function bootstrap() {
  // Load API keys from durable file before first render.
  // This recovers keys that survived a WebView reset.
  await hydrateSettingsFromFile((partial) => useStore.setState(partial))

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap()
