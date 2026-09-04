import { useState, useEffect, type FormEvent } from 'react';
import { Printer, Save, Radio, TestTube, ChevronRight, RefreshCw } from 'lucide-react';
import { trpc } from '../../trpc';
import { es } from '../../shared/i18n';
import { Card } from '../../shared/components/Card';
import { LoadingButton } from '../../shared/components/LoadingButton';
import { LoadingSpinner } from '../../shared/components/LoadingSpinner';

type ConnectionType = 'USB' | 'TCP' | 'Windows';

interface PrinterConfig {
  type: ConnectionType;
  paperWidth: number;
  characterSet: string;
  connectionString: string;
}

export default function PrinterSettingsPage(): JSX.Element {
  const [form, setForm] = useState<PrinterConfig>({
    type: 'USB',
    paperWidth: 80,
    characterSet: 'PC850',
    connectionString: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [printers, setPrinters] = useState<string[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => setMessage(''), 4000);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const config = await trpc.config.getPrinter.query();
        if (!cancelled && config) {
          setForm(config as PrinterConfig);
        }
      } catch {
        // use defaults
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const loadPrinters = async () => {
    setLoadingPrinters(true);
    try {
      const list = await trpc.config.listPrinters.query();
      setPrinters(list);
    } catch {
      setPrinters([]);
    } finally {
      setLoadingPrinters(false);
    }
  };

  useEffect(() => {
    if (form.type === 'Windows') {
      void loadPrinters();
    }
  }, [form.type]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await trpc.config.setPrinter.mutate({ printer: form });
      showMessage('Configuración de impresora guardada.', 'success');
    } catch {
      showMessage('Error al guardar configuración.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTestPrint = async () => {
    setTesting(true);
    try {
      const result = await trpc.config.testPrinter.mutate({ printer: form });
      showMessage(result.message, result.success ? 'success' : 'error');
    } catch {
      showMessage('Error al enviar prueba de impresión.', 'error');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
          <Printer size={16} />
          <span>{es.settings.printer.title}</span>
          <ChevronRight size={14} />
          <span className="text-indigo-600 font-semibold">{es.settings.printer.subtitle}</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{es.settings.printer.title}</h1>
        <p className="text-sm text-gray-500">{es.settings.printer.subtitle}</p>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
          messageType === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message}
        </div>
      )}

      <form onSubmit={handleSave}>
        <Card title={es.settings.printer.title} subtitle={es.settings.printer.subtitle}>
          <div className="space-y-5">
            <div>
              <label className="tc-label flex items-center gap-2">
                <Radio size={14} className="text-gray-400" />
                {es.settings.printer.type}
              </label>
              <div className="flex gap-3">
                {(['USB', 'TCP', 'Windows'] as ConnectionType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, type }))}
                    className={`px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all cursor-pointer ${
                      form.type === type
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {type === 'USB' ? 'USB' : type === 'TCP' ? 'TCP/IP' : 'Windows'}
                  </button>
                ))}
              </div>
            </div>

            {form.type === 'Windows' && (
              <div>
                <label className="tc-label flex items-center gap-2">
                  Impresora del sistema
                  <button
                    type="button"
                    onClick={loadPrinters}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 cursor-pointer"
                  >
                    <RefreshCw size={12} className={loadingPrinters ? 'animate-spin' : ''} />
                    Refrescar
                  </button>
                </label>
                <select
                  value={form.connectionString}
                  onChange={(e) => setForm((prev) => ({ ...prev, connectionString: e.target.value }))}
                  className="tc-input"
                  disabled={loadingPrinters}
                >
                  <option value="">Seleccionar impresora...</option>
                  {printers.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1.5">
                  {loadingPrinters
                    ? 'Cargando impresoras instaladas...'
                    : printers.length === 0
                      ? 'No se encontraron impresoras. Verifique la instalación de Windows.'
                      : 'Seleccione la impresora térmica correcta para evitar imprimir en otra.'}
                </p>
              </div>
            )}

            <div>
              <label className="tc-label">{es.settings.printer.paperWidth}</label>
              <select
                value={form.paperWidth}
                onChange={(e) => setForm((prev) => ({ ...prev, paperWidth: Number(e.target.value) }))}
                className="tc-input"
              >
                <option value={58}>58 mm</option>
                <option value={80}>80 mm</option>
              </select>
            </div>

            <div>
              <label className="tc-label">{es.settings.printer.characterSet}</label>
              <select
                value={form.characterSet}
                onChange={(e) => setForm((prev) => ({ ...prev, characterSet: e.target.value }))}
                className="tc-input"
              >
                <option value="PC850">PC850 (Latin-1)</option>
                <option value="PC437">PC437 (US/Europa)</option>
                <option value="PC860">PC860 (Portugal)</option>
                <option value="PC865">PC865 (Nórdico)</option>
                <option value="UTF-8">UTF-8</option>
              </select>
            </div>

            <div>
              <label className="tc-label">{es.settings.printer.connection}</label>
              <input
                type="text"
                value={form.connectionString}
                onChange={(e) => setForm((prev) => ({ ...prev, connectionString: e.target.value }))}
                placeholder={es.settings.printer.connectionPlaceholder}
                className="tc-input"
              />
              <p className="text-xs text-gray-400 mt-1.5">{es.settings.printer.connectionHelp}</p>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200 flex items-center justify-between">
            <LoadingButton type="button" variant="secondary" onClick={handleTestPrint} loading={testing}>
              <TestTube size={16} />
              {es.settings.printer.test}
            </LoadingButton>
            <LoadingButton type="submit" loading={saving}>
              <Save size={16} />
              {es.common.save}
            </LoadingButton>
          </div>
        </Card>
      </form>
    </div>
  );
}
