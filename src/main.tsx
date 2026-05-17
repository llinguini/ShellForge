import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("ShellForge root element was not found");
}

createRoot(rootElement).render(<App />);
