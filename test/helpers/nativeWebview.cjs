const assert=require('node:assert/strict'),net=require('node:net');
const {performance}=require('node:perf_hooks');
const HOST_TIMEOUT_MS=60000;
const EXTENSION_ID_PATTERN=/(?:[?&]|^)extensionId=zhangxh-math\.texleaf(?:&|$)/iu;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const errorText=e=>String(e.stack||e);
class WebviewProbePool {
  constructor(port) {
    this.port = port;
    this.clients = new Map();
  }

  async waitFor(expression, predicate, description, timeoutMs) {
    const deadline = performance.now() + timeoutMs;
    let last = [];
    while (performance.now() < deadline) {
      const candidates = await this.targets();
      const probes = await Promise.all(candidates.map(async (target) => {
        try {
          const client = await this.clientFor(target);
          for (const contextId of client.contextIds) {
            const value = await client.evaluate(expression, 3_000, contextId);
            if (predicate(value)) { client.preferredContextId=contextId; return { target, client, value }; }
          }
          return { target, client, value: {contexts:[...client.contextIds]} };
        } catch (error) {
          this.drop(target.id);
          return { target, error: errorText(error) };
        }
      }));
      last = probes.map((probe) => ({
        id: probe.target.id,
        title: probe.target.title,
        ...(Object.hasOwn(probe, "value") ? { value: probe.value } : { error: probe.error }),
      }));
      const match = probes.find((probe) => Object.hasOwn(probe, "value") && predicate(probe.value));
      if (match?.client) return { target: match.target, client: match.client, value: match.value };
      await delay(100);
    }
    throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(last)}`);
  }

  async targets() {
    const values = await fetchTargets(this.port);
    return values.filter((candidate) =>
      candidate?.type === "iframe" &&
      typeof candidate.id === "string" &&
      typeof candidate.webSocketDebuggerUrl === "string" &&
      EXTENSION_ID_PATTERN.test(candidate.url ?? ""));
  }

  async clientFor(target) {
    const existing = this.clients.get(target.id);
    if (existing) return existing;
    const client = await connectCdp(target.webSocketDebuggerUrl);
    await client.request("Runtime.enable");
    await client.request("Log.enable");
    await client.request("Network.enable");
    this.clients.set(target.id, client);
    return client;
  }

  drop(targetId) {
    this.clients.get(targetId)?.close();
    this.clients.delete(targetId);
  }

  async closeBrowser() {
    const client = this.clients.values().next().value;
    if (!client) return false;
    try {
      await client.request("Browser.close", {}, 5_000);
      return true;
    } catch {
      return false;
    }
  }

  close() {
    for (const client of this.clients.values()) client.close();
    this.clients.clear();
  }
}

async function connectWorkbench(port, title) {
  const deadline = performance.now() + HOST_TIMEOUT_MS;
  let last = [];
  while (performance.now() < deadline) {
    last = (await fetchTargets(port)).filter((target) => target?.type === "page");
    const target = last.find((candidate) => candidate.title?.includes(title)) ?? last[0];
    if (target?.webSocketDebuggerUrl) {
      const client = await connectCdp(target.webSocketDebuggerUrl);
      await client.request("Runtime.enable");
      await client.request("Page.enable");
      return { target, client };
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for VS Code workbench: ${JSON.stringify(last)}`);
}

async function resizeWorkbench(client, targetId) {
  try {
    const { windowId } = await client.request("Browser.getWindowForTarget", { targetId });
    await client.request("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    await client.request("Browser.setWindowBounds", { windowId, bounds: { width: 880, height: 720 } });
  } catch {
    // Geometry is an additional adaptive-card check; input correctness remains
    // useful on window managers that reject Browser.setWindowBounds.
  }
}

async function fetchTargets(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return [];
    const values = await response.json();
    return Array.isArray(values) ? values : [];
  } catch {
    return [];
  }
}

function connectCdp(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map(),contextIds=new Set(),events=[];
    let nextId = 1;
    let settled = false;
    const openingTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("CDP connect timeout"));
    }, 10_000);
    socket.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(openingTimeout);
      resolve({
        contextIds,events,preferredContextId:undefined,
        request(method, params = {}, timeoutMs = 15_000) {
          const id = nextId++;
          return new Promise((requestResolve, requestReject) => {
            const timeout = setTimeout(() => {
              pending.delete(id);
              requestReject(new Error(`CDP ${method} timed out`));
            }, timeoutMs);
            pending.set(id, { resolve: requestResolve, reject: requestReject, timeout });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        async evaluate(expression, timeoutMs = 15_000, contextId=this.preferredContextId) {
          const response = await this.request("Runtime.evaluate", {
            expression,
            ...(contextId===undefined?{}:{contextId}),
            returnByValue: true,
            awaitPromise: true,
          }, timeoutMs);
          if (response.exceptionDetails) {
            const description = response.exceptionDetails.exception?.description;
            const location = Number.isInteger(response.exceptionDetails.lineNumber)
              ? ` at ${response.exceptionDetails.lineNumber + 1}:${(response.exceptionDetails.columnNumber ?? 0) + 1}`
              : "";
            throw new Error(`${description ?? response.exceptionDetails.text ?? "Runtime.evaluate failed"}${location}`);
          }
          return response.result?.value;
        },
        close() {
          socket.close();
        },
      });
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id !== "number") {
        if(message.method==='Runtime.executionContextCreated')contextIds.add(message.params.context.id);
        if(message.method==='Runtime.executionContextDestroyed')contextIds.delete(message.params.executionContextId);
        if(message.method==='Runtime.executionContextsCleared')contextIds.clear();
        if(['Log.entryAdded','Runtime.exceptionThrown','Runtime.consoleAPICalled','Network.loadingFailed'].includes(message.method)&&events.length<100)events.push({method:message.method,params:message.params});
        return;
      }
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      clearTimeout(waiter.timeout);
      if (message.error) waiter.reject(new Error(`CDP ${message.error.code}: ${message.error.message}`));
      else waiter.resolve(message.result);
    });
    socket.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(openingTimeout);
        reject(new Error("CDP WebSocket failed"));
      }
    });
    socket.addEventListener("close", () => {
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error("CDP WebSocket closed"));
      }
      pending.clear();
    });
  });
}

async function findAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  assert.ok(Number.isSafeInteger(port) && port >= 1_024 && port <= 65_535, "Could not reserve a CDP port");
  return port;
}


module.exports={WebviewProbePool,connectWorkbench,findAvailablePort,delay};
