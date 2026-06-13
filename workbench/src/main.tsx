import React from "react";
import ReactDOM from "react-dom/client";
// 节点 3.1：tokens.css 先于 reset.css 加载，确保 reset 能引用 var(--font) 等
import "./styles/tokens.css";
import "./styles/reset.css";
import App from "./App";
import { useStore } from "./store";
import { hydrateSettingsFromFile } from "./store/settingsSlice";
import { initAgentEventDispatcher } from "./lib/agentEventDispatcher";

async function bootstrap() {
  // Load API keys from durable file before first render.
  // This recovers keys that survived a WebView reset.
  await hydrateSettingsFromFile((partial) => useStore.setState(partial))

  // 节点 2.3：初始化 agent 事件分发器，注册 'agent:event' IPC 监听
  initAgentEventDispatcher()

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap()
