export class MCPClient {
  constructor(private url: string) {}

  async jsonRpc(method: string, params?: any) {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method,
        params,
      }),
    });
    return res.json();
  }

  async listTools() {
    const r: any = await this.jsonRpc("tools/list", {});
    return r.result?.tools ?? [];
  }

  async callTool(name: string, args: any) {
    const r: any = await this.jsonRpc("tools/call", {
      name,
      arguments: args,
    });
    if (r.error) throw new Error(r.error.message);
    return r.result;
  }
}
