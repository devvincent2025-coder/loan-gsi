'use client';
import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, KeyRound } from 'lucide-react';
import type { SettingDto } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/empty-state';
import { useCan } from '@/lib/auth';
import { errorMessage, get } from '@/lib/api';
import { NamespaceEditor } from './namespace-editor';
import { ProductsTab } from './products-tab';
import { TemplatesTab } from './templates-tab';
import { LogsTab } from './logs-tab';
import { IntegrationsTab } from './integrations-tab';

const NAMESPACE_TABS = [
  { value: 'general', label: 'General' },
  { value: 'security', label: 'Security' },
  { value: 'fees', label: 'Fees' },
  { value: 'scorecards', label: 'Scorecards' },
  { value: 'llm-pii', label: 'LLM & PII', namespaces: ['llm', 'pii'] },
] as const;

export default function SettingsPage() {
  const canUpdate = useCan('settings:update');
  const canProducts = useCan('product:read');
  const canTemplates = useCan('template:read');
  const canLogs = useCan('notification:read');
  const canIntegrations = useCan('integration:read');
  const canRoles = useCan('role:read');
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<{ settings: SettingDto[] }>('/settings') });
  const all = settings.data?.settings ?? [];

  return (
    <>
      <PageHeader title="Settings" description={canUpdate ? 'Platform configuration. Changes are audited.' : 'Read-only: you need settings:update to edit.'} />
      <Tabs defaultValue="general">
        <TabsList>
          {NAMESPACE_TABS.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
          {canProducts && <TabsTrigger value="products">Products</TabsTrigger>}
          {canTemplates && <TabsTrigger value="templates">Templates</TabsTrigger>}
          {canLogs && <TabsTrigger value="logs">Delivery logs</TabsTrigger>}
          {canIntegrations && <TabsTrigger value="integrations">Integrations</TabsTrigger>}
          {canRoles && <TabsTrigger value="roles">Roles</TabsTrigger>}
        </TabsList>
        {NAMESPACE_TABS.map((t) => {
          const namespaces: readonly string[] = 'namespaces' in t ? t.namespaces : [t.value];
          return (
            <TabsContent key={t.value} value={t.value}>
              {settings.isLoading && <Skeleton className="h-48" />}
              {settings.isError && <Card><ErrorState message={errorMessage(settings.error)} onRetry={() => settings.refetch()} /></Card>}
              {settings.data && <NamespaceEditor settings={all.filter((s) => namespaces.includes(s.namespace))} canUpdate={canUpdate} />}
            </TabsContent>
          );
        })}
        {canProducts && <TabsContent value="products"><ProductsTab /></TabsContent>}
        {canTemplates && <TabsContent value="templates"><TemplatesTab /></TabsContent>}
        {canLogs && <TabsContent value="logs"><LogsTab /></TabsContent>}
        {canIntegrations && <TabsContent value="integrations"><IntegrationsTab /></TabsContent>}
        {canRoles && (
          <TabsContent value="roles">
            <Link href="/roles">
              <Card className="flex items-center gap-4 p-5 transition-colors hover:bg-muted/40">
                <div className="flex size-10 items-center justify-center rounded-md bg-accent text-accent-foreground"><KeyRound className="size-5" aria-hidden /></div>
                <div className="flex-1"><p className="font-semibold">Roles & Permissions</p><p className="text-sm text-muted-foreground">Edit the permission matrix and approval limits.</p></div>
                <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
              </Card>
            </Link>
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
