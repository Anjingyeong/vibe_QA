import { captureScreenshot } from "./screenshot.js";
import { closeContexts } from "./cleanup.js";
import { installAuthorization } from "./target-policy.js";
import { createActions, ObservedDefect } from "./actions.js";
import { REQUIRED_FLOW_IDS, PROFILES } from "./plan.js";

function captureRuntime(page, events, sanitizer) {
  page.on("console", (message) => events.push({ type: "console", level: message.type(),
    message: sanitizer.text(message.text()), source: sanitizer.text(message.location().url ?? "") }));
  page.on("pageerror", (error) => events.push({ type: "pageerror", message: sanitizer.text(error.message) }));
  page.on("requestfailed", (request) => events.push({ type: "requestfailed", method: request.method(),
    url: sanitizer.text(request.url()), failure: sanitizer.text(request.failure()?.errorText ?? "unknown") }));
  page.on("response", (response) => events.push({ type: "response", method: response.request().method(),
    url: sanitizer.text(response.url()), status: response.status(),
    contentType: (response.headers()["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() }));
}

function failedFinding(flowId, profile, error, screenshot) {
  const actual = error instanceof Error ? error.message : String(error);
  return { signature: `flow:${flowId}:${profile}:failed`, severity: "major",
    title: `${flowId} could not be safely completed on ${profile}`,
    reproduction: [`Run ${flowId} with the ${profile} browser profile.`],
    expected: `The ${flowId} flow completes with machine-confirmed evidence.`, actual, screenshot,
    machineEvidence: [{ type: "assertion", detail: actual }] };
}

export async function runProfile({ browser, execution, target, artifactRoot, policy, sanitizer, lookup }) {
  const options = PROFILES[execution.profile];
  const contexts = []; const pages = {}; const events = [];
  const state = { pages, events, target, sanitizer, profile: options, active: null, room: null,
    songSources: [], expectedUrls: new Set() };
  const completedFlowIds = []; const findings = []; const steps = [];
  let primaryError;
  try {
    for (const actor of ["solo", "host", "guest"]) {
      const context = await browser.newContext({ viewport: options.viewport, isMobile: Boolean(options.isMobile) });
      contexts.push(context); context.setDefaultTimeout(15_000); context.setDefaultNavigationTimeout(30_000);
      await installAuthorization(context, policy, { lookup });
      pages[actor] = await context.newPage(); captureRuntime(pages[actor], events, sanitizer);
    }
    state.active = pages.host;
    const actions = createActions(state);
    for (const flowId of REQUIRED_FLOW_IDS) {
      let evidence = []; let error; let observed;
      try { evidence = await actions[flowId](); }
      catch (caught) {
        if (caught instanceof ObservedDefect) observed = caught;
        else error = caught;
      }
      const relative = `${execution.runId}/${execution.profile}/${String(steps.length + 1).padStart(2, "0")}-${flowId}.png`;
      let screenshot;
      try {
        screenshot = await captureScreenshot(state.active ?? pages.host, artifactRoot, relative, [],
          sanitizer.values());
      }
      catch (caught) { error ??= caught; }
      if (error || observed) {
        const finding = failedFinding(flowId, execution.profile, error ?? observed, screenshot);
        if (observed) finding.machineEvidence = observed.machineEvidence;
        findings.push(sanitizer.clean(finding)); primaryError ??= error;
        if (observed) completedFlowIds.push(flowId);
      } else completedFlowIds.push(flowId);
      steps.push(sanitizer.clean({ flowId, passed: !error && !observed, screenshot,
        machineEvidence: observed?.machineEvidence ?? evidence,
        actual: error || observed ? (error ?? observed).message ?? String(error ?? observed) : "completed" }));
      if (error) break;
    }
  } finally {
    if (state.room && pages.host && !pages.host.isClosed()) {
      try {
        const receipt = await pages.host.evaluate(async (room) => { const response = await fetch(`/api/rooms/${room.code}`,
          { method: "DELETE", headers: { authorization: `Bearer ${room.token}` } });
          return { status: response.status, body: await response.text() }; }, state.room);
        if (receipt.status < 200 || receipt.status >= 300) throw new Error(`fallback cleanup status=${receipt.status}`);
        state.room = null;
      } catch (error) {
        const safe = sanitizer.text(error.message ?? error);
        if (!primaryError) primaryError = new Error(`fallback cleanup failed: ${safe}`);
      }
    }
    await closeContexts(contexts);
  }
  if (primaryError) {
    const message = sanitizer.text(primaryError.message ?? primaryError);
    if (!findings.length) throw new Error(message);
  }
  return sanitizer.clean({ profile: execution.profile, viewport: options.viewport, completedFlowIds,
    findings, steps, runtimeEvents: events, actorContextsClosed: true });
}
