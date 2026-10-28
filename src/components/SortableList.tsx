import * as React from 'react';
import { GripVertical } from 'lucide-react';
import { DndContext, MouseSensor, TouchSensor, KeyboardSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function SortableList<T extends { id: string; text: string }>({ items, onChange, children }: {
  items: T[]; onChange: (items: T[]) => void; children: React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const name = (id: string | number) => items.find(item => item.id === id)?.text || 'Item';
  return <DndContext sensors={sensors} collisionDetection={closestCenter}
    onDragEnd={({ active, over }) => {
      if (!over || active.id === over.id) return;
      const from = items.findIndex(item => item.id === active.id);
      const to = items.findIndex(item => item.id === over.id);
      if (from >= 0 && to >= 0) onChange(arrayMove(items, from, to));
    }}
    accessibility={{ announcements: {
      onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
      onDragOver: ({ active, over }) => over ? `${name(active.id)}, position ${items.findIndex(item => item.id === over.id) + 1} of ${items.length}.` : undefined,
      onDragEnd: ({ active, over }) => over ? `Dropped ${name(active.id)} at position ${items.findIndex(item => item.id === over.id) + 1}.` : 'Reordering cancelled.',
      onDragCancel: () => 'Reordering cancelled.',
    } }}>
    <SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
      {children}
    </SortableContext>
  </DndContext>;
}

export function SortableRow({ id, label, className, children }: {
  id: string; label: string; className?: string; children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return <li ref={setNodeRef} data-sortable-id={id}
    style={{ transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 1 : undefined }}
    className={cn('sortable-row group flex items-center gap-2.5 [&+&]:border-t [&+&]:border-dotted [&+&]:border-rule',
      isDragging && 'rounded-[var(--radius-control)] bg-paper shadow-lg', className)}>
    <Button ref={setActivatorNodeRef} {...attributes} {...listeners} variant="ghost" size="icon-sm"
      data-print-hide className="size-9 shrink-0 touch-none cursor-grab active:cursor-grabbing"
      aria-label={`Reorder ${label}`} title="Hold and drag to reorder">
      <GripVertical aria-hidden="true" />
    </Button>
    {children}
  </li>;
}
