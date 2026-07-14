import { Link } from "react-router-dom";

export default function RouteState({ isError = false }) {
  const title = isError ? "This page could not be opened" : "Page not found";

  return (
    <main className="state-shell">
      <section className="state-card route-state-card">
        <h1>{title}</h1>
        <p>{isError ? "Something interrupted this page. Return to a safe starting point and try again." : "The address may be incorrect or the page may have moved."}</p>
        <Link className="primary-action" to="/">Go to home</Link>
      </section>
    </main>
  );
}
