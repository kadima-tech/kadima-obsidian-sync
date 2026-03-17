import { FakeApp, TFile, TFolder, TAbstractFile, Notice } from "./mocks/obsidian";

export function normalizePath(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+$/, "").replace(/^\/+/, "");
}

export { FakeApp as App, Notice, TFile, TFolder, TAbstractFile };
export type Plugin = any;

export async function requestUrl(options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
    throw?: boolean;
}) {
    try {
        const response = await fetch(options.url, {
            method: options.method || "GET",
            headers: options.headers,
            body: options.body,
        });

    const arrayBuffer = await response.arrayBuffer();
    const text = new TextDecoder().decode(arrayBuffer);
    let json: any = null;
    try {
        json = JSON.parse(text);
    } catch (e) {}

    return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        text: text,
        json: json,
        arrayBuffer: arrayBuffer,
    };
    } catch (e: any) {
        console.error(`[Shim] fetch failed for ${options.url}:`, e);
        return {
            status: 0,
            headers: {},
            text: e.message,
            json: { error: e.message },
            arrayBuffer: new ArrayBuffer(0),
        };
    }
}
