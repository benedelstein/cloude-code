"use client";

import { useMemo, useState } from "react";
import { HelpCircle } from "lucide-react";
import type { PendingQuestion, QuestionResponse } from "@repo/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface PendingQuestionCardProps {
  pendingQuestion: PendingQuestion;
  onAnswer: (questionId: string, responses: QuestionResponse[]) => void;
}

/**
 * Interactive card rendered when the agent calls the ask_user tool and blocks
 * for an answer. Selections are collected per question, then submitted back to
 * the agent which resumes its turn with the chosen option(s).
 */
export function PendingQuestionCard({
  pendingQuestion,
  onAnswer,
}: PendingQuestionCardProps) {
  const { questionId, questions } = pendingQuestion;
  // Map of question index -> set of selected option labels.
  const [selections, setSelections] = useState<Record<number, string[]>>({});

  // Reset local selection state whenever a new question arrives.
  const resetKey = questionId;
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setSelections({});
  }

  const toggleOption = (questionIndex: number, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = prev[questionIndex] ?? [];
      if (multiSelect) {
        const next = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
        return { ...prev, [questionIndex]: next };
      }
      return { ...prev, [questionIndex]: [label] };
    });
  };

  const allAnswered = useMemo(
    () => questions.every((_, index) => (selections[index]?.length ?? 0) > 0),
    [questions, selections],
  );

  const submit = () => {
    if (!allAnswered) { return; }
    const responses: QuestionResponse[] = questions.map((q, index) => ({
      header: q.header,
      selected: selections[index] ?? [],
    }));
    onAnswer(questionId, responses);
  };

  return (
    <div className="my-2 rounded-md border border-border bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
        <HelpCircle className="h-4 w-4 text-foreground-secondary" />
        <span>The agent has a question</span>
      </div>
      <div className="space-y-4">
        {questions.map((q, questionIndex) => {
          const multiSelect = q.multiSelect ?? false;
          const selected = selections[questionIndex] ?? [];
          return (
            <div key={`${questionId}-${questionIndex}`} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground-secondary">
                  {q.header}
                </span>
                <p className="text-sm text-foreground">{q.question}</p>
              </div>
              <div className="space-y-1.5">
                {q.options.map((option) => {
                  const isSelected = selected.includes(option.label);
                  return (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => toggleOption(questionIndex, option.label, multiSelect)}
                      className={cn(
                        "w-full rounded-md border px-3 py-2 text-left transition-colors",
                        isSelected
                          ? "border-accent bg-accent-subtle"
                          : "border-border bg-background hover:bg-muted",
                      )}
                    >
                      <p className="text-sm font-medium text-foreground">{option.label}</p>
                      {option.description && (
                        <p className="mt-0.5 text-xs text-foreground-secondary">
                          {option.description}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end">
        <Button size="sm" onClick={submit} disabled={!allAnswered}>
          Submit
        </Button>
      </div>
    </div>
  );
}
