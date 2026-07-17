/**
 * K7 Ink confirm — y/n overlay (replaces raw-mode confirm when TUI active)
 */

import React, { useState } from 'react';
import { render, Box, Text, useInput } from 'ink';

export interface ConfirmInkProps {
  question: string;
  onDone: (ok: boolean) => void;
}

export function ConfirmInk({ question, onDone }: ConfirmInkProps): React.ReactElement {
  const [hint] = useState('y = yes · n = no · Esc = cancel');
  useInput((input, key) => {
    if (key.escape) {
      onDone(false);
      return;
    }
    if (input === 'y' || input === 'Y') {
      onDone(true);
      return;
    }
    if (input === 'n' || input === 'N') {
      onDone(false);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">Permission</Text>
      <Text>{question}</Text>
      <Text dimColor>{hint}</Text>
    </Box>
  );
}

/** 渲染临时 Ink 确认框；结束后 unmount */
export function promptConfirmInk(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const instance = render(
      <ConfirmInk
        question={question}
        onDone={(ok) => {
          instance.unmount();
          resolve(ok);
        }}
      />
    );
  });
}
