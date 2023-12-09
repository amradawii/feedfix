import React from 'react';

export type StepId = 'upload' | 'problems' | 'review' | 'export';

export interface StepItem {
  id: StepId;
  number: number;
  label: string;
}

const STEPS: StepItem[] = [
  { id: 'upload', number: 1, label: 'Upload' },
  { id: 'problems', number: 2, label: 'Problems' },
  { id: 'review', number: 3, label: 'Review' },
  { id: 'export', number: 4, label: 'Export' },
];

interface StepperProps {
  currentStep: StepId;
  hasFile: boolean;
  onSelectStep: (step: StepId) => void;
}

export function Stepper({ currentStep, hasFile, onSelectStep }: StepperProps) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const idx = STEPS.findIndex((s) => s.id === currentStep);
    if (event.key === 'ArrowRight' && idx < STEPS.length - 1) {
      const next = STEPS[idx + 1];
      if (hasFile || next.id === 'upload') {
        event.preventDefault();
        onSelectStep(next.id);
      }
    } else if (event.key === 'ArrowLeft' && idx > 0) {
      event.preventDefault();
      onSelectStep(STEPS[idx - 1].id);
    }
  };

  return (
    <nav aria-label="Steps" onKeyDown={handleKeyDown} className="flex flex-wrap items-center gap-1">
      {STEPS.map((step, index) => {
        const isActive = step.id === currentStep;
        const isDisabled = !hasFile && step.id !== 'upload';

        return (
          <React.Fragment key={step.id}>
            {index > 0 && (
              <span className="mx-1.5 text-neutral-300 select-none" aria-hidden="true">
                &middot;
              </span>
            )}
            <button
              type="button"
              disabled={isDisabled}
              aria-current={isActive ? 'step' : undefined}
              onClick={() => onSelectStep(step.id)}
              className={[
                'rounded px-1.5 py-0.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40',
                isActive
                  ? 'font-semibold text-accent'
                  : isDisabled
                  ? 'cursor-not-allowed text-neutral-400'
                  : 'text-neutral-600 hover:text-neutral-900',
              ].join(' ')}
            >
              <span className="tabular-nums">{step.number}</span> {step.label}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}
