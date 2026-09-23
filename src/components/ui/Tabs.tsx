import * as TabsPrimitive from '@radix-ui/react-tabs';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <TabsPrimitive.List
      className={cn(
        'border-line bg-surface-2/50 inline-flex items-center gap-1 rounded-[var(--radius-pill)] border p-1',
        className,
      )}
    >
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className="group text-fg-muted data-[state=active]:text-fg relative rounded-[var(--radius-pill)] px-3 py-1.5 text-xs font-medium transition-colors"
    >
      <span className="relative z-10">{children}</span>
      <span className="absolute inset-0 hidden group-data-[state=active]:block">
        <motion.span
          layoutId="tabs-active"
          transition={{ type: 'spring', stiffness: 460, damping: 36 }}
          className="bg-surface shadow-e1 border-line absolute inset-0 rounded-[var(--radius-pill)] border"
        />
      </span>
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Content value={value} className="anim-rise mt-4 space-y-4 focus:outline-none">
      {children}
    </TabsPrimitive.Content>
  );
}
