import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { KnowledgeList, KnowledgeForm } from '@/components/knowledge';
import { useKnowledge } from '@/hooks/useKnowledge';
import type { KnowledgeItem } from '@/types';

export function SettingsPage() {
  const {
    items,
    isLoading,
    create,
    update,
    toggleActive,
    isCreating,
    isUpdating,
  } = useKnowledge();

  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);

  function handleNewItem() {
    setEditingItem(null);
    setShowForm(true);
  }

  function handleEdit(item: KnowledgeItem) {
    setEditingItem(item);
    setShowForm(true);
  }

  function handleCancel() {
    setShowForm(false);
    setEditingItem(null);
  }

  async function handleSave(data: { category: string; title: string; content: string }) {
    if (editingItem) {
      await update({ id: editingItem.id, ...data });
    } else {
      await create(data);
    }
    setShowForm(false);
    setEditingItem(null);
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
      <p className="mt-2 text-muted">Configurações do agente e base de conhecimento.</p>

      {/* Knowledge Base Section */}
      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Base de Conhecimento</h2>
          <Button size="sm" onClick={handleNewItem}>
            <Plus className="mr-1 h-4 w-4" />
            Nova base de conhecimento
          </Button>
        </div>

        {showForm && (
          <div className="mb-4">
            <KnowledgeForm
              item={editingItem}
              onSave={handleSave}
              onCancel={handleCancel}
              isLoading={isCreating || isUpdating}
            />
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando base de conhecimento...
          </div>
        ) : (
          <KnowledgeList
            items={items}
            onEdit={handleEdit}
            onToggleActive={toggleActive}
          />
        )}
      </section>
    </div>
  );
}
