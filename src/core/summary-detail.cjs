"use strict";

const LEVELS = Object.freeze({ brief: [1000, 3000], standard: [3000, 10000], detailed: [10000, 30000] });
function normalizeSummaryDetail(value) { return Object.hasOwn(LEVELS, value) ? value : "standard"; }

function summaryBudget(transcript, detail = "standard") {
  const level = normalizeSummaryDetail(detail);
  const text = String(transcript || "");
  const ranges = [...text.matchAll(/\[(\d{2,}):(\d{2}):(\d{2})[–-](\d{2,}):(\d{2}):(\d{2})\]/g)];
  const seconds = (parts, offset) => Number(parts[offset]) * 3600 + Number(parts[offset + 1]) * 60 + Number(parts[offset + 2]);
  const content = text.replace(/^.*\[(\d{2,}):(\d{2}):(\d{2})[–-][^\]]+\]\s*[^:]+:\s*/gm, "");
  const durationMinutes = ranges.length
    ? Math.max(1 / 60, (ranges.reduce((end, m) => Math.max(end, seconds(m, 4)), 0) - ranges.reduce((start, m) => Math.min(start, seconds(m, 1)), Infinity)) / 60)
    : Math.max(1 / 60, content.length / 750);
  const scale = durationMinutes < 45 ? durationMinutes / 45 : durationMinutes > 60 ? durationMinutes / 60 : 1;
  const round = n => Math.round(n / 100) * 100;
  // Targets are editorial guidance, never padding or a hard text cut-off.
  const max = Math.max(300, Math.min(round(LEVELS[level][1] * scale), round(content.length * 0.95)));
  const min = Math.min(max, Math.max(100, round(LEVELS[level][0] * scale)));
  return { level, min, max, durationMinutes };
}

function detailInstructions(transcript, detail = "standard", locale = "ru") {
  const { level, min, max } = summaryBudget(transcript, detail);
  const en = locale === "en";
  const styles = en ? {
    brief: "Brief: prioritize conclusions, decisions, action items, deadlines and unresolved risks. Give each major topic a concise mention; omit secondary examples.",
    standard: "Standard: cover every major topic, the essential context and arguments, decisions, action items and open questions.",
    detailed: "Detailed: cover all substantive topics, reasoning, alternatives, figures, constraints and dependencies, in addition to decisions and action items."
  } : {
    brief: "Краткая: акцент на выводах, решениях, задачах, сроках и открытых рисках. Каждую основную тему обозначь коротко; второстепенные примеры можно опустить.",
    standard: "Обычная: раскрой каждую основную тему, необходимый контекст и аргументы, решения, задачи и открытые вопросы.",
    detailed: "Подробная: раскрой все содержательные темы, аргументы, альтернативы, цифры, ограничения и зависимости, а также решения и задачи."
  };
  return en
    ? `Selected detail level — ${styles[level]} Aim for approximately ${min}–${max} characters including spaces for THIS meeting. This overrides generic length recommendations. Adapt to substantive content: never pad, repeat facts or invent details to reach a minimum. Preserve important decisions and commitments even if a dense meeting exceeds the soft target. Keep all six sections, short where appropriate.`
    : `Выбранная подробность — ${styles[level]} Ориентир для ЭТОГО разговора: примерно ${min}–${max} символов с пробелами. Это уточняет общие рекомендации по объёму. Учитывай насыщенность: не добавляй воду, повторы и выдуманные детали ради нижней границы. Важные решения и обязательства сохраняй, даже если для насыщенного разговора придётся превысить мягкий ориентир. Сохрани все шесть разделов, при необходимости короткими.`;
}

module.exports = { LEVELS, normalizeSummaryDetail, summaryBudget, detailInstructions };
