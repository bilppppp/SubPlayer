"use client";

import { useEffect, useState } from "react";
import { Loader2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettings, type HighlightStyle } from "@/store/settings";
import { getAsrCapability } from "@/lib/api";
import type { AsrCapabilityResponse } from "@/types";

const FONT_OPTIONS = [
    { label: "系统默认 (Sans-serif)", value: "sans-serif" },
    { label: "思源黑体 (Noto Sans SC)", value: "'Noto Sans SC', sans-serif" },
    { label: "微软雅黑 (Microsoft YaHei)", value: "'Microsoft YaHei', sans-serif" },
    { label: "苹方 (PingFang SC)", value: "'PingFang SC', sans-serif" },
    { label: "系统衬线 (Serif)", value: "serif" },
    { label: "思源宋体 (Noto Serif SC)", value: "'Noto Serif SC', serif" },
    { label: "系统等宽 (Monospace)", value: "monospace" },
    { label: "圆体 (Rounded)", value: "ui-rounded, 'Hiragino Maru Gothic ProN', sans-serif" },
    { label: "Inter", value: "'Inter', sans-serif" },
    { label: "Roboto", value: "'Roboto', sans-serif" },
];

export function SettingsDialog() {
    const settings = useSettings();
    const [open, setOpen] = useState(false);
    const [activeCredTab, setActiveCredTab] = useState("volcengine");
    const [checkingCapability, setCheckingCapability] = useState(false);
    const [capability, setCapability] = useState<AsrCapabilityResponse | null>(null);
    const [appearanceDraft, setAppearanceDraft] = useState({
        panelFontFamily: settings.panelFontFamily,
        panelFontSize: settings.panelFontSize,
        highlightStyle: settings.highlightStyle,
        playerFontFamily: settings.playerFontFamily,
        playerFontSize: settings.playerFontSize,
    });
    const [blockDraft, setBlockDraft] = useState({
        useReadableBlocks: settings.useReadableBlocks,
        blockMaxCharsZh: settings.blockMaxCharsZh,
        blockMaxCharsEn: settings.blockMaxCharsEn,
        blockMaxLines: settings.blockMaxLines,
        blockMaxDuration: settings.blockMaxDuration,
        blockMinDuration: settings.blockMinDuration,
        blockTolerance: settings.blockTolerance,
    });

    useEffect(() => {
        if (!open) return;
        setAppearanceDraft({
            panelFontFamily: settings.panelFontFamily,
            panelFontSize: settings.panelFontSize,
            highlightStyle: settings.highlightStyle,
            playerFontFamily: settings.playerFontFamily,
            playerFontSize: settings.playerFontSize,
        });
        setBlockDraft({
            useReadableBlocks: settings.useReadableBlocks,
            blockMaxCharsZh: settings.blockMaxCharsZh,
            blockMaxCharsEn: settings.blockMaxCharsEn,
            blockMaxLines: settings.blockMaxLines,
            blockMaxDuration: settings.blockMaxDuration,
            blockMinDuration: settings.blockMinDuration,
            blockTolerance: settings.blockTolerance,
        });
    }, [open, settings.blockMaxCharsEn, settings.blockMaxCharsZh, settings.blockMaxDuration, settings.blockMaxLines, settings.blockMinDuration, settings.blockTolerance, settings.highlightStyle, settings.panelFontFamily, settings.panelFontSize, settings.playerFontFamily, settings.playerFontSize, settings.useReadableBlocks]);

    const applySubtitleSettings = () => {
        settings.setAppearance(appearanceDraft);
        settings.setBlockSettings(blockDraft);
    };

    const handleDetectCapability = async () => {
        setCheckingCapability(true);
        try {
            const result = await getAsrCapability();
            setCapability(result);
        } finally {
            setCheckingCapability(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Settings">
                    <Settings className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>设置 (Settings)</DialogTitle>
                    <DialogDescription>
                        配置 API 密钥和界面外观
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="api" className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="api">API 密钥</TabsTrigger>
                        <TabsTrigger value="appearance">外观样式</TabsTrigger>
                        <TabsTrigger value="readable">阅读排版</TabsTrigger>
                    </TabsList>

                    <TabsContent value="api" className="space-y-6 py-4">
                        <div className="space-y-4">
                            <Label className="text-base font-semibold">服务商凭据 (Credentials)</Label>
                            <Select
                                value={activeCredTab}
                                onValueChange={(val) => setActiveCredTab(val)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="选择服务商" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="volcengine">火山引擎 (Volcengine)</SelectItem>
                                    <SelectItem value="aliyun">阿里云百炼 (Dashscope)</SelectItem>
                                    <SelectItem value="gemini">Google Gemini</SelectItem>
                                    <SelectItem value="deepseek">DeepSeek 官方</SelectItem>
                                </SelectContent>
                            </Select>

                            {activeCredTab === "volcengine" && (
                                <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
                                    <div className="space-y-2">
                                        <Label>App ID</Label>
                                        <Input
                                            type="text"
                                            value={settings.volcengineAppId}
                                            onChange={(e) => settings.setApiKeys({ volcengineAppId: e.target.value })}
                                            placeholder="在此输入 App ID"
                                            className="bg-background"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Access Token</Label>
                                        <Input
                                            type="password"
                                            value={settings.volcengineToken}
                                            onChange={(e) => settings.setApiKeys({ volcengineToken: e.target.value })}
                                            placeholder="在此输入 Token"
                                            className="bg-background"
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">用于高精度的语音识别 (ASR)。</p>
                                </div>
                            )}

                            {activeCredTab === "aliyun" && (
                                <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
                                    <div className="space-y-2">
                                        <Label>API Key</Label>
                                        <Input
                                            type="password"
                                            value={settings.aliyunKey}
                                            onChange={(e) => settings.setApiKeys({ aliyunKey: e.target.value })}
                                            placeholder="sk-..."
                                            className="bg-background"
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">支持 SenseVoice 语音识别，及 DeepSeek 模型翻译。</p>
                                </div>
                            )}

                            {activeCredTab === "gemini" && (
                                <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
                                    <div className="space-y-2">
                                        <Label>API Key</Label>
                                        <Input
                                            type="password"
                                            value={settings.geminiKey}
                                            onChange={(e) => settings.setApiKeys({ geminiKey: e.target.value })}
                                            placeholder="AIza..."
                                            className="bg-background"
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">用于极其快速准确的字幕文本翻译。</p>
                                </div>
                            )}

                            {activeCredTab === "deepseek" && (
                                <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
                                    <div className="space-y-2">
                                        <Label>API Key</Label>
                                        <Input
                                            type="password"
                                            value={settings.deepseekKey}
                                            onChange={(e) => settings.setApiKeys({ deepseekKey: e.target.value })}
                                            placeholder="sk-..."
                                            className="bg-background"
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">DeepSeek 官方 API 支持。</p>
                                </div>
                            )}
                        </div>

                        <div className="space-y-4 pt-4 border-t">
                            <Label className="text-base font-semibold">功能调度 (Service Routing)</Label>

                            <div className="space-y-2">
                                <Label>语音识别 (ASR) 服务商</Label>
                                <Select
                                    value={settings.asrProvider || "auto"}
                                    onValueChange={(val: "auto" | "volcengine" | "aliyun" | "local") => settings.setApiKeys({ asrProvider: val })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="auto">自动 (跟随配置系统依赖)</SelectItem>
                                        <SelectItem value="volcengine">火山引擎 (Volcengine)</SelectItem>
                                        <SelectItem value="aliyun">阿里云百炼 (SenseVoice)</SelectItem>
                                        <SelectItem value="local">本地 (FunASR)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>文本翻译 (Translation) 服务商</Label>
                                <Select
                                    value={settings.translateProvider || "auto"}
                                    onValueChange={(val: "auto" | "gemini" | "deepseek" | "qwen") => settings.setApiKeys({ translateProvider: val })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="auto">自动 (优先 Gemini, 备用目标)</SelectItem>
                                        <SelectItem value="gemini">Gemini</SelectItem>
                                        <SelectItem value="deepseek">DeepSeek 官方</SelectItem>
                                        <SelectItem value="qwen">阿里通义千问 (Qwen)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2 rounded-xl border bg-card p-3">
                                <div className="flex items-center justify-between">
                                    <Label>ASR 环境检测</Label>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={handleDetectCapability}
                                        disabled={checkingCapability}
                                    >
                                        {checkingCapability ? (
                                            <>
                                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                                检测中
                                            </>
                                        ) : (
                                            "主动检测"
                                        )}
                                    </Button>
                                </div>
                                {!capability && (
                                    <p className="text-xs text-muted-foreground">
                                        点击“主动检测”查看当前机器是否可跑本地 ASR，以及是否可自动降级到云端。
                                    </p>
                                )}
                                {capability && (
                                    <div className="space-y-1 text-xs text-muted-foreground">
                                        <p>可转写: {capability.capability?.canTranscribe ? "是" : "否"}</p>
                                        <p>本地可用: {capability.capability?.localReady ? "是" : "否"}（{capability.capability?.localReason || "-"}）</p>
                                        <p>本地模型: {capability.capability?.localModelsLoaded ? "已加载" : "未加载"}</p>
                                        <p>系统依赖: ffmpeg {capability.capability?.ffmpegReady ? "OK" : "NO"} / ffprobe {capability.capability?.ffprobeReady ? "OK" : "NO"} / yt-dlp {capability.capability?.ytDlpReady ? "OK" : "NO"}</p>
                                        <p>云端可用: Volcengine {capability.capability?.cloudAvailable?.volcengine ? "OK" : "NO"} / Aliyun {capability.capability?.cloudAvailable?.aliyun ? "OK" : "NO"}</p>
                                        <p>推荐提供商: {capability.capability?.recommendedProvider || "none"}</p>
                                        <p>自动顺序: {(capability.provider_order_auto || []).join(" -> ") || "-"}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="appearance" className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>字幕高亮样式</Label>
                            <Select
                                value={appearanceDraft.highlightStyle}
                                onValueChange={(val: HighlightStyle) => setAppearanceDraft((d) => ({ ...d, highlightStyle: val }))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="default">默认 (背景色)</SelectItem>
                                    <SelectItem value="underline">下划线</SelectItem>
                                    <SelectItem value="left-border">左侧边框</SelectItem>
                                    <SelectItem value="glow">发光效果</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>字幕面板字体</Label>
                            <Select
                                value={appearanceDraft.panelFontFamily}
                                onValueChange={(val) => setAppearanceDraft((d) => ({ ...d, panelFontFamily: val }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="选择字体" />
                                </SelectTrigger>
                                <SelectContent>
                                    {FONT_OPTIONS.map((font) => (
                                        <SelectItem
                                            key={font.value}
                                            value={font.value}
                                            style={{ fontFamily: font.value }}
                                        >
                                            {font.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>字幕面板字号</Label>
                            <Input
                                type="text"
                                value={appearanceDraft.panelFontSize}
                                onChange={(e) => setAppearanceDraft((d) => ({ ...d, panelFontSize: e.target.value }))}
                                placeholder="例如: 14px, 1rem"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>视频嵌字字体</Label>
                            <Select
                                value={appearanceDraft.playerFontFamily}
                                onValueChange={(val) => setAppearanceDraft((d) => ({ ...d, playerFontFamily: val }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="选择字体" />
                                </SelectTrigger>
                                <SelectContent>
                                    {FONT_OPTIONS.map((font) => (
                                        <SelectItem
                                            key={font.value}
                                            value={font.value}
                                            style={{ fontFamily: font.value }}
                                        >
                                            {font.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>视频嵌字字号</Label>
                            <Input
                                type="text"
                                value={appearanceDraft.playerFontSize}
                                onChange={(e) => setAppearanceDraft((d) => ({ ...d, playerFontSize: e.target.value }))}
                                placeholder="例如: 24px, 1.5rem"
                            />
                        </div>
                    </TabsContent>

                    <TabsContent value="readable" className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <Label>启用智能短句合并 (Dual-Track)</Label>
                                <input
                                    type="checkbox"
                                    checked={blockDraft.useReadableBlocks}
                                    onChange={(e) => setBlockDraft((d) => ({ ...d, useReadableBlocks: e.target.checked }))}
                                    className="rounded border-border bg-background"
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">将细碎的短句智能合并为更适合阅读的长句字幕块。</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>中日最大字数/行</Label>
                                <Input
                                    type="number"
                                    value={blockDraft.blockMaxCharsZh}
                                    onChange={(e) => setBlockDraft((d) => ({ ...d, blockMaxCharsZh: Number(e.target.value) }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>英文最大字符数/行</Label>
                                <Input
                                    type="number"
                                    value={blockDraft.blockMaxCharsEn}
                                    onChange={(e) => setBlockDraft((d) => ({ ...d, blockMaxCharsEn: Number(e.target.value) }))}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>合并上限行数</Label>
                                <Input
                                    type="number"
                                    value={blockDraft.blockMaxLines}
                                    onChange={(e) => setBlockDraft((d) => ({ ...d, blockMaxLines: Number(e.target.value) }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>字数溢出容忍度 (0~1)</Label>
                                <Input
                                    type="number"
                                    step="0.05"
                                    value={blockDraft.blockTolerance}
                                    onChange={(e) => setBlockDraft((d) => ({ ...d, blockTolerance: Number(e.target.value) }))}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>最小合并时长 (秒)</Label>
                                <Input
                                    type="number"
                                    step="0.1"
                                    value={blockDraft.blockMinDuration}
                                    onChange={(e) => setBlockDraft((d) => ({ ...d, blockMinDuration: Number(e.target.value) }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>最大合并时长 (秒)</Label>
                                <Input
                                    type="number"
                                    step="0.1"
                                    value={blockDraft.blockMaxDuration}
                                    onChange={(e) => setBlockDraft((d) => ({ ...d, blockMaxDuration: Number(e.target.value) }))}
                                />
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
                <div className="mt-2 flex items-center justify-end gap-2 border-t pt-3">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            setAppearanceDraft({
                                panelFontFamily: "sans-serif",
                                panelFontSize: "14px",
                                highlightStyle: "default",
                                playerFontFamily: "sans-serif",
                                playerFontSize: "24px",
                            });
                            setBlockDraft({
                                useReadableBlocks: true,
                                blockMaxCharsZh: 22,
                                blockMaxCharsEn: 42,
                                blockMaxLines: 2,
                                blockMaxDuration: 4.5,
                                blockMinDuration: 1.2,
                                blockTolerance: 0.15,
                            });
                        }}
                    >
                        重置字幕设置
                    </Button>
                    <Button size="sm" onClick={applySubtitleSettings}>
                        应用字幕设置
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
