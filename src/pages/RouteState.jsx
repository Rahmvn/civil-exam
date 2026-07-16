import { useEffect } from "react";
import { Link, useRouteError } from "react-router-dom";
import { logAppError, resolveAppProblem } from "../lib/errors";

export default function RouteState({ isError = false }) {
  const routeError = useRouteError();
  const problem = isError
    ? resolveAppProblem(routeError, { fallback: "Something interrupted this page. Your account and progress have not been changed." })
    : null;
  const title = isError ? problem.title : "Page not found";

  useEffect(() => {
    if (isError && routeError) logAppError("Route render failure", routeError);
  }, [isError, routeError]);

  return (
    <main className="state-shell">
      <section className="state-card route-state-card">
        <h1>{title}</h1>
        <p>{isError ? problem.message : "The address may be incorrect or the page may have moved."}</p>
        <div className="route-state-actions">
          {isError && (
            <button className="primary-action" onClick={() => window.location.reload()} type="button">
              Refresh page
            </button>
          )}
          <Link className={isError ? "text-action" : "primary-action"} to="/">Go to home</Link>
        </div>
      </section>
    </main>
  );
}
