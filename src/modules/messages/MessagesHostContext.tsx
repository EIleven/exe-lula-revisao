// src/modules/messages/MessagesHostContext.tsx
'use client';

import React, { createContext, useContext } from 'react';
import {
  defaultStandaloneMessagesHost,
  type MessagesHostAdapter,
} from './contracts';

const MessagesHostContext = createContext<MessagesHostAdapter>(defaultStandaloneMessagesHost);

export const MessagesHostProvider: React.FC<{
  adapter?: MessagesHostAdapter;
  children: React.ReactNode;
}> = ({ adapter, children }) => {
  return (
    <MessagesHostContext.Provider value={adapter ?? defaultStandaloneMessagesHost}>
      {children}
    </MessagesHostContext.Provider>
  );
};

export function useMessagesHost(): MessagesHostAdapter {
  return useContext(MessagesHostContext);
}

