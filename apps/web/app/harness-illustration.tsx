"use client";

import Image from "next/image";

export function HarnessIllustration() {
  return (
    <div className="relative h-48 w-64 sm:h-56 sm:w-72">
      <Image
        src="/claude_code_icon.svg"
        alt="Claude Code"
        width={96}
        height={96}
        className="absolute left-1/2 top-2 h-20 w-20 -translate-x-1/2 object-contain sm:h-24 sm:w-24"
      />
      <Image
        src="/openai_logo.svg"
        alt="OpenAI"
        width={88}
        height={88}
        className="absolute bottom-4 left-4 h-20 w-20 object-contain sm:h-24 sm:w-24"
      />
      <Image
        src="/gemini_logo.svg"
        alt="Gemini"
        width={88}
        height={88}
        className="absolute bottom-8 right-2 h-20 w-20 object-contain sm:h-24 sm:w-24"
      />
    </div>
  );
}
