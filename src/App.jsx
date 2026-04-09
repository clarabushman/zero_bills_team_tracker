import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  AlertCircle, CheckCircle2, XCircle, Clock, BarChart3, 
  BatteryWarning, Zap, ChevronDown, Filter, Car, 
  Settings, Gauge, Info, Search
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

// --- Utilities ---
const parseCSV = (str) => {
  const arr = [];
  let quote = false;
  let row = 0, col = 0;
  for (let i = 0; i < str.length; i++) {
    let cc = str[i], nc = str[i + 1];
    arr[row] = arr[row] || [];
    arr[row][col] = arr[row][col] || '';
    if (cc === '"' && quote && nc === '"') { arr[row][col] += cc; ++i; continue; }
    if (cc === '"') { quote = !quote; continue; }
    if (cc === ',' && !quote) { ++col; continue; }
    if (cc === '\r' && nc === '\n' && !quote) { ++row; col = 0; ++i; continue; }
    if (cc === '\n' && !quote) { ++row; col = 0; continue; }
    arr[row][col] += cc;
  }
  return arr;
};

export default function App() {
  const [data, setData] = useState([]);
  const [activeTab, setActiveTab] = useState('Overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drillDown, setDrillDown] = useState(null); // For "Click to see list"

  // Filters
  const [selectedTranches, setSelectedTranches] = useState(new Set());
  const [selectedSites, setSelectedSites] = useState(new Set());
  const [trancheOpen, setTrancheOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch('/data.csv');
        if (!response.ok) throw new Error("Missing data.csv in public folder.");
        const text = await response.text();
        const rows = parseCSV(text);
        const headers = rows[0].map(h => h?.trim());
        const parsed = rows.slice(1).filter(r => r.length > 1).map(row => {
          let obj = {};
          headers.forEach((h, i) => obj[h] = row[i]?.trim());
          return obj;
        });
        setData(parsed);
      } catch (err) { setError(err.message); }
      finally { setLoading(false); }
    };
    loadData();
  }, []);

  // --- Filtering Logic ---
  const filteredData = useMemo(() => {
    return data.filter(row => {
      const matchTranche = selectedTranches.size === 0 || selectedTranches.has(row.tranche);
      const matchSite = selectedSites.size === 0 || selectedSites.has(row.site_name);
      return matchTranche && matchSite;
    });
  }, [data, selectedTranches, selectedSites]);

  const filterOptions = useMemo(() => {
    const tranches = [...new Set(data.map(r => r.tranche))].filter(Boolean).sort();
    const sites = [...new Set(data.map(r => r.site_name))].filter(Boolean).sort();
    return { tranches, sites };
  }, [data]);

  // --- Sub-data for Tabs ---
  const tabData = useMemo(() => {
    const isZB = (t) => String(t).toLowerCase().includes('zero');
    
    return {
      overview: {
        total: filteredData.filter(r => r.latest_account_number_for_address || r.import_mpans).length,
        zb: filteredData.filter(r => isZB(r.import_tariff)).length,
        standard: filteredData.filter(r => r.import_tariff && !isZB(r.import_tariff)).length
      },
      tariffIssues: filteredData.filter(r => {
        const dateMismatch = r.kraken_import_tariff_valid_to !== r.agreement_valid_to || 
                           r.kraken_export_tariff_valid_to !== r.agreement_valid_to;
        const wrongDevTariff = r.account_type === 'developer' && isZB(r.import_tariff);
        return dateMismatch || wrongDevTariff;
      }),
      ev: {
        confirmed: filteredData.filter(r => r.ev_billed === 'TRUE').length,
        suspected: filteredData.filter(r => r.suspected_ev === 'TRUE').length
      },
      battery: {
        total: filteredData.length,
        setup: filteredData.filter(r => r.battery_setup === 'TRUE').length,
        offline: filteredData.filter(r => r.battery_setup === 'TRUE' && r.battery_online === 'FALSE').length,
        online: filteredData.filter(r => r.battery_setup === 'TRUE' && r.battery_online === 'TRUE').length
      }
    };
  }, [filteredData]);

  // --- Render Helpers ---
  const AccountTable = ({ list }) => (
    <div className="overflow-x-auto mt-4 bg-white rounded-lg border">
      <table className="w-full text-sm text-left">
        <thead className="bg-gray-50 text-gray-600 font-medium">
          <tr>
            <th className="p-3">Account #</th>
            <th className="p-3">Site</th>
            <th className="p-3">Tariff</th>
            <th className="p-3">Valid To</th>
            <th className="p-3">Contract Days</th>
            <th className="p-3">PSR</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {list.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="p-3 font-mono">{row.latest_account_number_for_address}</td>
              <td className="p-3">{row.site_name}</td>
              <td className="p-3">{row.import_tariff}</td>
              <td className="p-3">{row.agreement_valid_to}</td>
              <td className="p-3">{row.days_this_contract}</td>
              <td className="p-3">{row.is_psr === 'TRUE' ? '✅' : '❌'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (loading) return <div className="p-10 text-center">Loading Dashboard...</div>;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      {/* Header & Filter Bar */}
      <div className="max-w-7xl mx-auto mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-6">Operations Performance Dashboard</h1>
        
        <div className="flex flex-wrap gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-2 text-slate-500 mr-4"><Filter size={18}/> Filters:</div>
          
          {/* Multi-select Tranche */}
          <div className="relative">
            <button onClick={() => setTrancheOpen(!trancheOpen)} className="px-4 py-2 border rounded-lg bg-white flex items-center gap-2">
              Tranches ({selectedTranches.size || 'All'}) <ChevronDown size={14}/>
            </button>
            {trancheOpen && (
              <div className="absolute z-50 mt-2 w-56 bg-white border shadow-xl rounded-lg p-2">
                {filterOptions.tranches.map(t => (
                  <label key={t} className="flex items-center gap-2 p-2 hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={selectedTranches.has(t)} onChange={() => {
                      const next = new Set(selectedTranches);
                      next.has(t) ? next.delete(t) : next.add(t);
                      setSelectedTranches(next);
                    }}/> {t}
                  </label>
                ))}
              </div>
            )}
          </div>
          {/* Site selection would follow similar pattern */}
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto">
        <div className="flex border-b border-slate-200 mb-6 gap-8">
          {['Overview', 'Tariff Issues', 'EV Tab', 'Battery Issues', 'Meters & MPANs', 'EOY Projection'].map(tab => (
            <button 
              key={tab} 
              onClick={() => {setActiveTab(tab); setDrillDown(null);}}
              className={`pb-4 text-sm font-semibold transition-colors ${activeTab === tab ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content: Overview */}
        {activeTab === 'Overview' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div onClick={() => setDrillDown(filteredData)} className="bg-white p-6 rounded-xl border shadow-sm cursor-pointer hover:border-indigo-300">
              <h3 className="text-slate-500 text-sm mb-2">Total Account Setup</h3>
              <div className="text-4xl font-bold">{tabData.overview.total}</div>
            </div>
            <div className="bg-white p-6 rounded-xl border shadow-sm">
              <h3 className="text-slate-500 text-sm mb-2">On Zero Bills</h3>
              <div className="text-4xl font-bold text-emerald-600">{tabData.overview.zb}</div>
            </div>
            <div className="bg-white p-6 rounded-xl border shadow-sm">
              <h3 className="text-slate-500 text-sm mb-2">On Standard</h3>
              <div className="text-4xl font-bold text-amber-600">{tabData.overview.standard}</div>
            </div>
            {drillDown && <div className="col-span-full"><AccountTable list={drillDown}/></div>}
          </div>
        )}

        {/* Tab Content: Battery Issues (Simplified Example of Requirement 5) */}
        {activeTab === 'Battery Issues' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-lg border">
                <div className="text-xs text-slate-500">Offline (% of Setup)</div>
                <div className="text-2xl font-bold text-red-600">
                  {((tabData.battery.offline / tabData.battery.setup) * 100 || 0).toFixed(1)}%
                </div>
              </div>
            </div>
            {/* Recharts Pie Chart and Site breakdown would go here */}
            <div className="bg-white p-6 rounded-xl border">
               <h3 className="font-bold mb-4">Battery Status Breakdown</h3>
               <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie 
                      data={[
                        { name: 'Online', value: tabData.battery.online },
                        { name: 'Offline', value: tabData.battery.offline },
                        { name: 'Not Setup', value: tabData.battery.total - tabData.battery.setup }
                      ]} 
                      innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value"
                    >
                      <Cell fill="#10b981" />
                      <Cell fill="#f43f5e" />
                      <Cell fill="#94a3b8" />
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
               </div>
            </div>
          </div>
        )}

        {/* Tab Content: EOY Projection (Requirement 7) */}
        {activeTab === 'EOY Projection' && (
          <div className="bg-white rounded-xl border p-6">
            <h3 className="font-bold mb-6">Net Import vs Fair Use (4000kWh)</h3>
            <div className="space-y-4">
              {filteredData.slice(0, 20).map((row, i) => {
                const val = parseFloat(row.eoy_projected_net_import);
                const color = val > 4000 ? 'bg-red-500' : val > 3500 ? 'bg-orange-600' : val > 3000 ? 'bg-orange-300' : 'bg-emerald-500';
                const progress = Math.min((val / 4000) * 100, 100);
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span>{row.latest_account_number_for_address}</span>
                      <span className="font-mono">{val} kWh</span>
                    </div>
                    <div className="w-full bg-slate-100 h-4 rounded-full overflow-hidden">
                      <div className={`${color} h-full`} style={{ width: `${progress}%` }}></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
