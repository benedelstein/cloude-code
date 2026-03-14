"use client";

import { SessionCreationForm } from "./session-creation-form";

export function HomePageClient() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-4 pb-16">
      <div className="w-full max-w-2xl">
        <div className="mb-10 flex flex-col gap-0">
          <div className="text-8xl mb-1 text-center">☁️</div>
          <h1 className="text-2xl font-semibold mb-1 text-center">
            What do you want to build?
          </h1>
          {/* <p className="text-sm text-foreground-muted mb-8 text-center">
          Pick a repo and describe the task.
        </p> */}
        </div>

        <SessionCreationForm />
      </div>
    </div>
  );
}
