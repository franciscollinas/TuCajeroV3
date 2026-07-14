import { useState, useEffect } from 'react';
import { Shield, ChevronRight } from 'lucide-react';
import { es } from '../../shared/i18n';
import { Card } from '../../shared/components/Card';
import { EmptyState } from '../../shared/components/EmptyState';
import { LoadingSpinner } from '../../shared/components/LoadingSpinner';

export default function AuditPage(): JSX.Element {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
          <Shield size={16} />
          <span>{es.audit.title}</span>
          <ChevronRight size={14} />
          <span className="text-indigo-600 font-semibold">{es.audit.subtitle}</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{es.audit.title}</h1>
        <p className="text-sm text-gray-500">{es.audit.subtitle}</p>
      </div>

      <Card>
        <EmptyState
          icon={Shield}
          title="Módulo de auditoría en construcción"
          description="El registro de auditoría estará disponible en una próxima actualización. Acá podrás consultar el historial inmutable de acciones críticas del sistema."
        />
      </Card>
    </div>
  );
}
