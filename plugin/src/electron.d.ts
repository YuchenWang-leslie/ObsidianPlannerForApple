declare module 'electron' {
    export const shell: {
        openExternal(url: string, options?: { activate?: boolean }): Promise<void>;
    };
}
