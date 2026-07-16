import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { configureAppErrorReporter, logAppError } from './lib/errors.js'
import { supabase } from './lib/supabaseClient.js'

configureAppErrorReporter(({ context, problemCode, status }) => supabase.rpc("record_app_error", {
  requested_context: context,
  requested_problem_code: problemCode,
  requested_page_path: window.location.pathname,
  requested_http_status: status,
}));

window.addEventListener("error", (event) => {
  logAppError("Unhandled browser error", event.error ?? new Error("Unhandled browser error"));
});

window.addEventListener("unhandledrejection", (event) => {
  logAppError("Unhandled promise rejection", event.reason ?? new Error("Unhandled promise rejection"));
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
