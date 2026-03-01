import type { Segment, ReadableBlock } from "@/types";

export interface ResegmentOptions {
    maxCharsPerLine: number;
    maxLines: number;
    overflowTolerance: number;
    minDurationSec: number;
    maxDurationSec: number;
}

function normalizeText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

export function joinSubtitleText(a: string, b: string): string {
    const left = normalizeText(a);
    const right = normalizeText(b);
    if (!left) return right;
    if (!right) return left;

    const cjk = /[\u3400-\u9fff]/;
    const leftEndsCjk = cjk.test(left[left.length - 1] ?? "");
    const rightStartsCjk = cjk.test(right[0] ?? "");

    if (leftEndsCjk || rightStartsCjk) {
        if (/^[，。！？；：,.!?;:)]/.test(right)) return `${left}${right}`;
        return `${left}${right}`;
    }

    if (/^[,.;:!?，。！？；：)\]}]/.test(right)) return `${left}${right}`;
    if (/[([{\-\u2014]$/.test(left)) return `${left}${right}`;
    return `${left} ${right}`;
}

export function generateReadableBlocks(
    segments: Segment[],
    targetLang: string,
    options: ResegmentOptions
): ReadableBlock[] {
    if (segments.length === 0) return [];

    const targetChars = options.maxCharsPerLine * options.maxLines;
    const hardMaxChars = targetChars * (1 + options.overflowTolerance);
    // IMPORTANT:
    // Keep block indices aligned with the original `segments` array.
    // Giant-segment splitting should happen upstream (page pipeline),
    // otherwise block indices drift and active highlighting becomes wrong.
    const workingSegments = segments;

    const blocks: ReadableBlock[] = [];
    let currentBlockSegments: Segment[] = [];
    let currentStartIndex = 0;

    for (let i = 0; i < workingSegments.length; i++) {
        const seg = workingSegments[i];
        const nextSeg = workingSegments[i + 1];

        currentBlockSegments.push(seg);

        const startObj = currentBlockSegments[0];
        const endObj = currentBlockSegments[currentBlockSegments.length - 1];
        const duration = endObj.end - startObj.start;

        const combinedText = currentBlockSegments.reduce((acc, s) => joinSubtitleText(acc, s.text), "");
        const combinedTrans = currentBlockSegments.reduce((acc, s) => joinSubtitleText(acc, s.translation || ""), "");

        const anchorText = combinedTrans || combinedText;
        const charCount = normalizeText(anchorText).replace(/\s+/g, "").length;

        const canCloseShortly = duration >= options.minDurationSec;
        const forceClose = duration >= options.maxDurationSec || charCount >= hardMaxChars;

        const isStrongEnd = /[.!?。！？]["')\]}\u201d\u2019]*\s*$/.test(normalizeText(anchorText));
        const isSoftEnd = /[,;:，；：]["')\]}\u201d\u2019]*\s*$/.test(normalizeText(anchorText));

        let isContin = false;
        if (nextSeg) {
            const t = normalizeText(nextSeg.translation || nextSeg.text).toLowerCase();
            if (targetLang.startsWith("zh")) {
                isContin = /^(而|而且|并且|并|但|但是|不过|然后|所以|因此|同时|以及|还有|因为|如果|虽然|并不|而是)/.test(t);
            } else {
                isContin = /^(and|but|or|so|because|that|which|who|whose|when|while|then|also|to|of|for|with)\b/.test(t);
            }
        }

        const closeBySentence = canCloseShortly && isStrongEnd && !isContin;
        const closeBySoftBoundary = canCloseShortly && duration >= (options.maxDurationSec * 0.7) && isSoftEnd && charCount > targetChars * 0.5;

        if (closeBySentence || closeBySoftBoundary || forceClose || i === workingSegments.length - 1) {
            blocks.push({
                startSegmentIndex: currentStartIndex,
                endSegmentIndex: i,
                start: startObj.start,
                end: endObj.end,
                text: combinedText,
                translation: combinedTrans
            });
            currentBlockSegments = [];
            currentStartIndex = i + 1;
        }
    }

    return mergeShortReadableBlocks(blocks, options);
}

function mergeShortReadableBlocks(blocks: ReadableBlock[], options: ResegmentOptions): ReadableBlock[] {
    if (blocks.length <= 1) return blocks;

    const out = [...blocks];
    let i = 0;
    while (i < out.length) {
        const block = out[i];
        const duration = block.end - block.start;

        if (duration < options.minDurationSec && out.length > 1) {
            if (i < out.length - 1) {
                const next = out[i + 1];
                out.splice(i, 2, {
                    startSegmentIndex: block.startSegmentIndex,
                    endSegmentIndex: next.endSegmentIndex,
                    start: block.start,
                    end: next.end,
                    text: joinSubtitleText(block.text, next.text),
                    translation: joinSubtitleText(block.translation || "", next.translation || "")
                });
                continue;
            } else if (i > 0) {
                const prev = out[i - 1];
                out.splice(i - 1, 2, {
                    startSegmentIndex: prev.startSegmentIndex,
                    endSegmentIndex: block.endSegmentIndex,
                    start: prev.start,
                    end: block.end,
                    text: joinSubtitleText(prev.text, block.text),
                    translation: joinSubtitleText(prev.translation || "", block.translation || "")
                });
                i = Math.max(0, i - 1);
                continue;
            }
        }
        i++;
    }
    return out;
}
