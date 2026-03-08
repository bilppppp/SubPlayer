import { create } from "zustand";
import { persist } from "zustand/middleware";

export type HighlightStyle = "default" | "underline" | "left-border" | "glow";

export interface SettingsState {
    gatewayApiKey: string;
    // APIs
    volcengineAppId: string;
    volcengineToken: string;
    volcengineSecretKey: string;
    volcengineResourceId: string;
    volcengineMode: "bigmodel_nostream" | "bigmodel" | "bigmodel_async" | "flash" | "legacy_auc";
    aliyunKey: string;
    geminiKey: string;
    deepseekKey: string;
    translateProvider: "auto" | "gemini" | "deepseek" | "qwen";
    asrProvider: "auto" | "volcengine" | "aliyun" | "local";
    allowAsrAutoDowngrade: boolean;

    // UI - Subtitle Panel
    panelFontFamily: string;
    panelFontSize: string;
    highlightStyle: HighlightStyle;

    // UI - Video Player
    playerFontFamily: string;
    playerFontSize: string;

    // Readable Blocks (Dual-Track)
    useReadableBlocks: boolean;
    blockMaxCharsZh: number;
    blockMaxCharsEn: number;
    blockMaxLines: number;
    blockMaxDuration: number;
    blockMinDuration: number;
    blockTolerance: number;

    // Actions
    setApiKeys: (keys: Partial<Pick<SettingsState, "gatewayApiKey" | "volcengineAppId" | "volcengineToken" | "volcengineSecretKey" | "volcengineResourceId" | "volcengineMode" | "aliyunKey" | "geminiKey" | "deepseekKey" | "translateProvider" | "asrProvider" | "allowAsrAutoDowngrade">>) => void;
    setAppearance: (appearance: Partial<Pick<SettingsState, "panelFontFamily" | "panelFontSize" | "highlightStyle" | "playerFontFamily" | "playerFontSize">>) => void;
    setBlockSettings: (configs: Partial<Pick<SettingsState, "useReadableBlocks" | "blockMaxCharsZh" | "blockMaxCharsEn" | "blockMaxLines" | "blockMaxDuration" | "blockMinDuration" | "blockTolerance">>) => void;
    resetSettings: () => void;
}

const initialState = {
    gatewayApiKey: "",
    volcengineAppId: "",
    volcengineToken: "",
    volcengineSecretKey: "",
    volcengineResourceId: "volc.seedasr.sauc.duration",
    volcengineMode: "flash" as const,
    aliyunKey: "",
    geminiKey: "",
    deepseekKey: "",
    translateProvider: "auto" as const,
    asrProvider: "auto" as const,
    allowAsrAutoDowngrade: false,

    panelFontFamily: "sans-serif",
    panelFontSize: "14px",
    highlightStyle: "default" as HighlightStyle,

    playerFontFamily: "sans-serif",
    playerFontSize: "24px",

    useReadableBlocks: true,
    blockMaxCharsZh: 22,
    blockMaxCharsEn: 42,
    blockMaxLines: 2,
    blockMaxDuration: 4.5,
    blockMinDuration: 1.2,
    blockTolerance: 0.15,
};

export const useSettings = create<SettingsState>()(
    persist(
        (set) => ({
            ...initialState,
            setApiKeys: (keys) => set((state) => ({ ...state, ...keys })),
            setAppearance: (appearance) => set((state) => ({ ...state, ...appearance })),
            setBlockSettings: (configs) => set((state) => ({ ...state, ...configs })),
            resetSettings: () => set(initialState),
        }),
        {
            name: "subplayer-settings",
        }
    )
);
