import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  AlertCircle, CheckCircle2, XCircle, Clock, BarChart3, 
  BatteryWarning, Zap, ChevronDown, Filter, Car, 
  Settings, Gauge, Info, Search, AlertTriangle, Battery, 
  ZapOff, Calendar, User, Building2, X
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';

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

const isZeroBills = (tariff) => String(tariff || '').toLowerCase().includes('zero');
const isTrue = (val) => String(val).toUpperCase() === 'TRUE';

export default function App() {
  const [data, setData] = useState([]);
  const [activeTab, setActiveTab] = useState('Overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Drilldown State
  const [drillDownTitle, setDrillDownTitle] = useState('');
  const [drillDownData, setDrillDownData] = useState(null);

  // Filters
  const [selectedTranches, setSelectedTranches] = useState(new Set());
  const [selectedSites, setSelectedSites] = useState(new Set());
  const [trancheOpen, setTrancheOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  
  const trancheRef = useRef(null);
  const siteRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (trancheRef.current && !trancheRef.current.contains(event.target)) setTrancheOpen(false);
      if (siteRef.current && !siteRef.current.contains(event.target)) setSiteOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch('/data.csv');
        if (!response.ok) throw new Error("Missing data.csv in public folder.");
        const text = await response.text();
        const rows = parseCSV(text);
        const rawHeaders = rows[0].map(h => h?.trim());
        const parsed = rows.slice(1).filter(r => r.length > 1).map(row => {
          let obj = {};
          rawHeaders.forEach((h, i) => obj[h] = row[i]?.trim());
          return obj;
        });
        setData(parsed);
      } catch (err) { setError(err.message); }
      finally { setLoading(false); }
    };
    loadData();
  }, []);

  // --- Filtering ---
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

  // --- Metrics Calculations ---
  const metrics = useMemo(() => {
    const today = new Date();
    
    // Req 1: Overview
    const allAccounts = filteredData.filter(r => r.latest_account_number_for_address || r.import_mpans);
    const zbAccounts = allAccounts.filter(r => isZeroBills(r.import_tariff));
    const stdAccounts = allAccounts.filter(r => r.import_tariff && !isZeroBills(r.import_tariff));

    // Req 3: Tariff Issues
    const tariffIssues = filteredData.filter(r => {
      const impMismatch = r.kraken_import_tariff_valid_to && r.kraken_import_tariff_valid_to !== r.agreement_valid_to;
      const expMismatch = r.kraken_export_tariff_valid_to && r.kraken_export_tariff_valid_to !== r.agreement_valid_to;
      const devWrongTariff = String(r.account_type).toLowerCase() === 'developer' && isZeroBills(r.import_tariff);
      return impMismatch || expMismatch || devWrongTariff;
    });

    // Req 4: EV
    const evConfirmed = filteredData.filter(r => isTrue(r.ev_billed));
    const evSuspected = filteredData.filter(r => isTrue(r.suspected_ev) && !isTrue(r.ev_billed));

    // Req 5: Battery
    const totalBattery = filteredData.length;
    const battSetup = filteredData.filter(r => isTrue(r.battery_setup));
    const battOnline = filteredData.filter(r => isTrue(r.battery_setup) && isTrue(r.battery_online));
    const battOffline = filteredData.filter(r => isTrue(r.battery_setup) && !isTrue(r.battery_online));
    const battNotSetup = filteredData.filter(r => !isTrue(r.battery_setup));

    // Battery Sites Breakdown
    const siteBreakdown = {};
    filteredData.forEach(r => {
      const site = r.site_name || 'Unknown';
      if (!siteBreakdown[site]) {
        siteBreakdown[site] = { name: site, total: 0, online: 0, offline: 0, notSetup: 0, onlineData: [], offlineData: [], notSetupData: [] };
      }
      siteBreakdown[site].total++;
      if (isTrue(r.battery_setup)) {
        if (isTrue(r.battery_online)) {
          siteBreakdown[site].online++;
          siteBreakdown[site].onlineData.push(r);
        } else {
          siteBreakdown[site].offline++;
          siteBreakdown[site].offlineData.push(r);
        }
      } else {
        siteBreakdown[site].notSetup++;
        siteBreakdown[site].notSetupData.push(r);
      }
    });

    // Req 6: Meters and MPANs
    const meterIssues = filteredData.filter(r => {
      let isStale = false;
      if (r.last_smart_read) {
        const readDate = new Date(r.last_smart_read);
        const daysOld = (today - readDate) / (1000 * 60 * 60 * 24);
        isStale = daysOld > 2;
      }
      const missingExport = !r.export_mpan || String(r.export_mpan).toLowerCase() === 'null';
      const denergised = String(r.import_energisation_status).toLowerCase() === 'denergised' || String(r.export_energisation_status).toLowerCase() === 'denergised';
      
      return isStale || missingExport || denergised;
    });

    return {
      allAccounts, zbAccounts, stdAccounts, 
      tariffIssues, 
      evConfirmed, evSuspected,
      totalBattery, battSetup, battOnline, battOffline, battNotSetup,
      siteBreakdown: Object.values(siteBreakdown).sort((a,b) => b.total - a.total),
      meterIssues
    };
  }, [filteredData]);

  // --- Reusable Components ---
  const handleDrillDown = (title, list) => {
    setDrillDownTitle(title);
    setDrillDownData(list);
  };

  // Common Table for Drilldowns (Req 2)
  const DrillDownModal = () => {
    if (!drillDownData) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-7xl max-h-[90vh] flex flex-col">
          <div className="p-4 border-b flex justify-between items-center bg-slate-50 rounded-t-xl">
            <h2 className="text-xl font-bold text-slate-800">{drillDownTitle} <span className="text-slate-500 text-sm font-normal">({drillDownData.length} records)</span></h2>
            <button onClick={() => setDrillDownData(null)} className="p-2 hover:bg-slate-200 rounded-full transition"><X size={20}/></button>
          </div>
          <div className="overflow-auto p-4">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="bg-slate-100 text-slate-600 sticky top-0">
                <tr>
                  <th className="p-3">Account / MPAN</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Tariff</th>
                  <th className="p-3">Valid From</th>
                  <th className="p-3">Valid To</th>
                  <th className="p-3">Days (Contract)</th>
                  <th className="p-3">Days (Tariff)</th>
                  <th className="p-3">Ops Team</th>
                  <th className="p-3">GSP</th>
                  <th className="p-3 text-center">PSR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drillDownData.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="p-3 font-medium text-slate-900">{row.latest_account_number_for_address || row.import_mpans}</td>
                    <td className="p-3 capitalize">{row.account_type}</td>
                    <td className="p-3 max-w-[150px] truncate" title={row.import_tariff}>{row.import_tariff}</td>
                    <td className="p-3">{row.agreement_valid_from}</td>
                    <td className="p-3">{row.agreement_valid_to}</td>
                    <td className="p-3">{row.days_this_contract}</td>
                    <td className="p-3">{row.days_on_tariff}</td>
                    <td className="p-3">{row.operations_team}</td>
                    <td className="p-3">{row.tariff_gsp_group_id}</td>
                    <td className="p-3 text-center">{isTrue(row.is_psr) ? '✅' : '⬜'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {drillDownData.length === 0 && <p className="text-center text-slate-500 py-8">No records found.</p>}
          </div>
        </div>
      </div>
    );
  };

  if (loading) return <div className="p-10 text-center flex justify-center items-center h-screen text-slate-500"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mr-3"></div> Loading Dashboard...</div>;
  if (error) return <div className="p-10 text-red-600 font-bold max-w-3xl mx-auto mt-10 bg-red-50 rounded-lg border border-red-200">Error: {error}</div>;

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-20">
      
      {/* Header & Filter Bar */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-[95%] mx-auto px-4 py-4 flex flex-col md:flex-row justify-between md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Gauge className="text-indigo-600"/> Zero Bills Operations
            </h1>
          </div>
          
          {/* Filters (Req 8) */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-slate-500 flex items-center gap-1"><Filter size={16}/> Filters</span>
            
            <div className="relative" ref={trancheRef}>
              <button onClick={() => setTrancheOpen(!trancheOpen)} className="px-4 py-2 text-sm border border-slate-300 rounded-lg bg-white flex items-center gap-2 hover:bg-slate-50">
                Tranches ({selectedTranches.size || 'All'}) <ChevronDown size={14}/>
              </button>
              {trancheOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-white border shadow-xl rounded-lg p-2 max-h-64 overflow-y-auto z-50">
                  {filterOptions.tranches.map(t => (
                    <label key={t} className="flex items-center gap-2 p-2 hover:bg-slate-50 cursor-pointer rounded text-sm">
                      <input type="checkbox" className="rounded text-indigo-600 focus:ring-indigo-500" checked={selectedTranches.has(t)} onChange={() => {
                        const next = new Set(selectedTranches);
                        next.has(t) ? next.delete(t) : next.add(t);
                        setSelectedTranches(next);
                      }}/> {t}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="relative" ref={siteRef}>
              <button onClick={() => setSiteOpen(!siteOpen)} className="px-4 py-2 text-sm border border-slate-300 rounded-lg bg-white flex items-center gap-2 hover:bg-slate-50">
                Sites ({selectedSites.size || 'All'}) <ChevronDown size={14}/>
              </button>
              {siteOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-white border shadow-xl rounded-lg p-2 max-h-64 overflow-y-auto z-50">
                  {filterOptions.sites.map(s => (
                    <label key={s} className="flex items-center gap-2 p-2 hover:bg-slate-50 cursor-pointer rounded text-sm">
                      <input type="checkbox" className="rounded text-indigo-600 focus:ring-indigo-500" checked={selectedSites.has(s)} onChange={() => {
                        const next = new Set(selectedSites);
                        next.has(s) ? next.delete(s) : next.add(s);
                        setSelectedSites(next);
                      }}/> {s}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="max-w-[95%] mx-auto px-4 mt-6">
        <div className="flex border-b border-slate-200 overflow-x-auto hide-scrollbar">
          {['Overview', 'Tariff Issues', 'EV', 'Battery Issues', 'Meters & MPANs', 'EOY Projection'].map(tab => (
            <button 
              key={tab} 
              onClick={() => setActiveTab(tab)}
              className={`pb-3 px-4 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 ${activeTab === tab ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-[95%] mx-auto px-4 mt-6">
        
        {/* Tab 1: Overview (Req 1 & 2) */}
        {activeTab === 'Overview' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div onClick={() => handleDrillDown('All Accounts', metrics.allAccounts)} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm cursor-pointer hover:border-indigo-400 hover:shadow-md transition">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-slate-600 font-medium">Total Accounts Set Up</h3>
                <Building2 className="text-indigo-500 bg-indigo-50 p-1.5 rounded-lg w-8 h-8"/>
              </div>
              <div className="text-4xl font-bold text-slate-900">{metrics.allAccounts.length}</div>
              <p className="text-sm text-slate-500 mt-2">Click to view all configured accounts</p>
            </div>
            
            <div onClick={() => handleDrillDown('Zero Bills Accounts', metrics.zbAccounts)} className="bg-white p-6 rounded-xl border border-emerald-200 shadow-sm cursor-pointer hover:border-emerald-400 hover:shadow-md transition">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-slate-600 font-medium">On Zero Bills Tariff</h3>
                <Zap className="text-emerald-500 bg-emerald-50 p-1.5 rounded-lg w-8 h-8"/>
              </div>
              <div className="text-4xl font-bold text-emerald-600">{metrics.zbAccounts.length}</div>
              <p className="text-sm text-emerald-600/70 mt-2">{((metrics.zbAccounts.length / metrics.allAccounts.length) * 100 || 0).toFixed(1)}% of total portfolio</p>
            </div>

            <div onClick={() => handleDrillDown('Standard Accounts', metrics.stdAccounts)} className="bg-white p-6 rounded-xl border border-amber-200 shadow-sm cursor-pointer hover:border-amber-400 hover:shadow-md transition">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-slate-600 font-medium">On Standard Tariff</h3>
                <Clock className="text-amber-500 bg-amber-50 p-1.5 rounded-lg w-8 h-8"/>
              </div>
              <div className="text-4xl font-bold text-amber-600">{metrics.stdAccounts.length}</div>
              <p className="text-sm text-amber-600/70 mt-2">Pending upgrade to Zero Bills</p>
            </div>
          </div>
        )}

        {/* Tab 2: Tariff Issues (Req 3) */}
        {activeTab === 'Tariff Issues' && (
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="p-6 border-b bg-red-50/50 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-red-700 flex items-center gap-2"><AlertTriangle size={20}/> Tariff Discrepancies ({metrics.tariffIssues.length})</h2>
                <p className="text-sm text-red-600/80 mt-1">End dates don't match agreement, or Developer is incorrectly on Zero Bills.</p>
              </div>
              <button onClick={() => handleDrillDown('All Tariff Issues', metrics.tariffIssues)} className="px-4 py-2 bg-white border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50">View as List</button>
            </div>
            <div className="overflow-x-auto p-4">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="p-3">Account</th>
                    <th className="p-3">Account Type</th>
                    <th className="p-3">Tariff</th>
                    <th className="p-3">Agreement Valid To</th>
                    <th className="p-3">Kraken Import To</th>
                    <th className="p-3">Kraken Export To</th>
                    <th className="p-3">Issue Flag</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {metrics.tariffIssues.map((r, i) => {
                    const devWrong = String(r.account_type).toLowerCase() === 'developer' && isZeroBills(r.import_tariff);
                    const impMismatch = r.kraken_import_tariff_valid_to && r.kraken_import_tariff_valid_to !== r.agreement_valid_to;
                    const expMismatch = r.kraken_export_tariff_valid_to && r.kraken_export_tariff_valid_to !== r.agreement_valid_to;
                    return (
                      <tr key={i}>
                        <td className="p-3 font-medium">{r.latest_account_number_for_address}</td>
                        <td className="p-3 capitalize">{r.account_type}</td>
                        <td className="p-3 truncate max-w-[150px]">{r.import_tariff}</td>
                        <td className="p-3 font-semibold">{r.agreement_valid_to}</td>
                        <td className={`p-3 ${impMismatch ? 'text-red-600 font-bold bg-red-50' : ''}`}>{r.kraken_import_tariff_valid_to || 'N/A'}</td>
                        <td className={`p-3 ${expMismatch ? 'text-red-600 font-bold bg-red-50' : ''}`}>{r.kraken_export_tariff_valid_to || 'N/A'}</td>
                        <td className="p-3 text-red-600 font-medium text-xs">
                          {devWrong && "Wrong Dev Tariff. "}
                          {(impMismatch || expMismatch) && "Date Mismatch."}
                        </td>
                      </tr>
                    );
                  })}
                  {metrics.tariffIssues.length === 0 && <tr><td colSpan="7" className="p-6 text-center text-slate-500">No issues found.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: EV (Req 4) */}
        {activeTab === 'EV' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white border rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2"><Car className="text-indigo-500"/> EV User Breakdown</h2>
              <div className="h-72 w-full cursor-pointer">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie 
                      data={[
                        { name: 'Confirmed EVs', value: metrics.evConfirmed.length, list: metrics.evConfirmed },
                        { name: 'Suspected EVs', value: metrics.evSuspected.length, list: metrics.evSuspected }
                      ]}
                      cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={5} dataKey="value"
                      onClick={(data) => handleDrillDown(data.name, data.list)}
                    >
                      <Cell fill="#10b981" /> {/* Emerald for Confirmed */}
                      <Cell fill="#f59e0b" /> {/* Amber for Suspected */}
                    </Pie>
                    <Tooltip formatter={(value, name) => [`${value} Accounts`, name]} />
                    <Legend verticalAlign="bottom" height={36}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <p className="text-center text-xs text-slate-500 mt-2">Click chart segments to view account lists</p>
            </div>
            
            <div className="space-y-4">
              <div onClick={() => handleDrillDown('Confirmed EV Users', metrics.evConfirmed)} className="bg-white border border-emerald-200 p-6 rounded-xl shadow-sm flex justify-between items-center cursor-pointer hover:bg-emerald-50 transition">
                <div>
                  <h3 className="text-emerald-700 font-bold">Confirmed EVs</h3>
                  <p className="text-emerald-600/70 text-sm">ev_billed is TRUE</p>
                </div>
                <div className="text-3xl font-bold text-emerald-600">{metrics.evConfirmed.length}</div>
              </div>
              <div onClick={() => handleDrillDown('Suspected EV Users', metrics.evSuspected)} className="bg-white border border-amber-200 p-6 rounded-xl shadow-sm flex justify-between items-center cursor-pointer hover:bg-amber-50 transition">
                <div>
                  <h3 className="text-amber-700 font-bold">Suspected EVs</h3>
                  <p className="text-amber-600/70 text-sm">suspected_ev is TRUE</p>
                </div>
                <div className="text-3xl font-bold text-amber-600">{metrics.evSuspected.length}</div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Battery Issues (Req 5) */}
        {activeTab === 'Battery Issues' && (
          <div className="space-y-6">
            
            {/* Top Stat Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-white p-4 rounded-xl border shadow-sm flex flex-col justify-center items-center">
                <span className="text-slate-500 text-xs font-bold uppercase">Total Accounts</span>
                <span className="text-2xl font-bold text-slate-900">{metrics.totalBattery}</span>
              </div>
              <div onClick={() => handleDrillDown('Batteries Setup', metrics.battSetup)} className="bg-white p-4 rounded-xl border border-indigo-200 shadow-sm flex flex-col justify-center items-center cursor-pointer hover:bg-indigo-50">
                <span className="text-indigo-600 text-xs font-bold uppercase">Setup</span>
                <span className="text-2xl font-bold text-indigo-700">{metrics.battSetup.length}</span>
                <span className="text-[10px] text-slate-500 mt-1">{((metrics.battSetup.length/metrics.totalBattery)*100 || 0).toFixed(1)}% of total</span>
              </div>
              <div onClick={() => handleDrillDown('Batteries Online', metrics.battOnline)} className="bg-white p-4 rounded-xl border border-emerald-200 shadow-sm flex flex-col justify-center items-center cursor-pointer hover:bg-emerald-50">
                <span className="text-emerald-600 text-xs font-bold uppercase">Online</span>
                <span className="text-2xl font-bold text-emerald-700">{metrics.battOnline.length}</span>
                <span className="text-[10px] text-slate-500 mt-1">{((metrics.battOnline.length/metrics.battSetup.length)*100 || 0).toFixed(1)}% of setup</span>
              </div>
              <div onClick={() => handleDrillDown('Batteries Offline', metrics.battOffline)} className="bg-white p-4 rounded-xl border border-red-200 shadow-sm flex flex-col justify-center items-center cursor-pointer hover:bg-red-50">
                <span className="text-red-600 text-xs font-bold uppercase">Setup but Offline</span>
                <span className="text-2xl font-bold text-red-700">{metrics.battOffline.length}</span>
                <span className="text-[10px] text-slate-500 mt-1">{((metrics.battOffline.length/metrics.battSetup.length)*100 || 0).toFixed(1)}% of setup</span>
              </div>
              <div onClick={() => handleDrillDown('Batteries Not Setup', metrics.battNotSetup)} className="bg-white p-4 rounded-xl border border-slate-300 shadow-sm flex flex-col justify-center items-center cursor-pointer hover:bg-slate-100">
                <span className="text-slate-600 text-xs font-bold uppercase">Not Setup</span>
                <span className="text-2xl font-bold text-slate-700">{metrics.battNotSetup.length}</span>
                <span className="text-[10px] text-slate-500 mt-1">{((metrics.battNotSetup.length/metrics.totalBattery)*100 || 0).toFixed(1)}% of total</span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Pie Chart */}
              <div className="bg-white p-6 rounded-xl border shadow-sm flex flex-col items-center">
                <h3 className="font-bold text-slate-800 self-start mb-4">Portfolio Overview</h3>
                <div className="w-full h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie 
                        data={[
                          { name: 'Online', value: metrics.battOnline.length, list: metrics.battOnline },
                          { name: 'Offline', value: metrics.battOffline.length, list: metrics.battOffline },
                          { name: 'Not Setup', value: metrics.battNotSetup.length, list: metrics.battNotSetup }
                        ]}
                        cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} dataKey="value"
                        onClick={(data) => handleDrillDown(`Battery: ${data.name}`, data.list)}
                      >
                        <Cell fill="#10b981" /> {/* Emerald */}
                        <Cell fill="#ef4444" /> {/* Red */}
                        <Cell fill="#cbd5e1" /> {/* Slate */}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Advanced Days/Stats List for Problematic Accounts */}
              <div className="lg:col-span-2 bg-white p-6 rounded-xl border shadow-sm overflow-hidden flex flex-col">
                <h3 className="font-bold text-slate-800 mb-4">Accounts Requiring Attention</h3>
                <div className="overflow-auto flex-1 border border-slate-100 rounded-lg">
                  <table className="w-full text-xs text-left whitespace-nowrap">
                    <thead className="bg-slate-50 text-slate-600 sticky top-0">
                      <tr>
                        <th className="p-2">Account</th>
                        <th className="p-2">Status</th>
                        <th className="p-2" title="Days still without battery setup">Days w/o Setup</th>
                        <th className="p-2" title="Days without setup in past (for online)">Past Days w/o Setup</th>
                        <th className="p-2" title="% without setup">% Time w/o Setup</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredData.filter(r => r.days_still_without_battery_setup || r.days_without_battery_setup_past).slice(0, 100).map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="p-2 font-medium">{r.latest_account_number_for_address}</td>
                          <td className="p-2">
                            {!isTrue(r.battery_setup) ? <span className="text-slate-500">Not Setup</span> :
                              isTrue(r.battery_online) ? <span className="text-emerald-600">Online</span> : <span className="text-red-600">Offline</span>}
                          </td>
                          <td className="p-2 text-red-600 font-bold">{r.days_still_without_battery_setup}</td>
                          <td className="p-2">{r.days_without_battery_setup_past}</td>
                          <td className="p-2">{r.without_battery_setup_percentage ? `${r.without_battery_setup_percentage}%` : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Site Breakdown Stacked Bar */}
            <div className="bg-white p-6 rounded-xl border shadow-sm">
              <h3 className="font-bold text-slate-800 mb-6">Site Breakdown (Progress & Status)</h3>
              <div className="space-y-5 max-h-96 overflow-y-auto pr-4">
                {metrics.siteBreakdown.map((site, i) => {
                  const progress = (site.online / site.total) * 100 || 0;
                  return (
                    <div key={i} className="flex flex-col gap-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-bold text-slate-700 truncate max-w-[50%]">{site.name}</span>
                        <span className="text-slate-500">
                          <span className="text-emerald-600 font-medium">{progress.toFixed(0)}% Online</span> 
                          {' '}({site.total} homes)
                        </span>
                      </div>
                      <div className="w-full h-5 flex rounded-md overflow-hidden bg-slate-100 cursor-pointer shadow-inner">
                        <div 
                          className="bg-emerald-500 hover:opacity-80 transition" 
                          style={{width: `${(site.online/site.total)*100}%`}} 
                          title={`${site.online} Online`}
                          onClick={() => handleDrillDown(`${site.name} - Online`, site.onlineData)}
                        ></div>
                        <div 
                          className="bg-red-500 hover:opacity-80 transition" 
                          style={{width: `${(site.offline/site.total)*100}%`}} 
                          title={`${site.offline} Offline`}
                          onClick={() => handleDrillDown(`${site.name} - Offline`, site.offlineData)}
                        ></div>
                        <div 
                          className="bg-slate-300 hover:opacity-80 transition" 
                          style={{width: `${(site.notSetup/site.total)*100}%`}} 
                          title={`${site.notSetup} Not Setup`}
                          onClick={() => handleDrillDown(`${site.name} - Not Setup`, site.notSetupData)}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
          </div>
        )}

        {/* Tab 5: Meters & MPANs (Req 6) */}
        {activeTab === 'Meters & MPANs' && (
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="p-6 border-b flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">Meter & MPAN Flags</h2>
              <button onClick={() => handleDrillDown('All Meter Issues', metrics.meterIssues)} className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm hover:bg-slate-50">View Extracted List</button>
            </div>
            <div className="overflow-x-auto p-4">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="p-3">Account</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Last Smart Read</th>
                    <th className="p-3">Export MPAN</th>
                    <th className="p-3">Days Missing Export</th>
                    <th className="p-3">Imp Energisation</th>
                    <th className="p-3">Exp Energisation</th>
                    <th className="p-3 bg-red-50">Detected Issues</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {metrics.meterIssues.map((r, i) => {
                    const readDate = new Date(r.last_smart_read);
                    const daysOld = (new Date() - readDate) / (1000 * 60 * 60 * 24);
                    const staleRead = daysOld > 2;
                    const missingExport = !r.export_mpan || String(r.export_mpan).toLowerCase() === 'null';
                    const impDen = String(r.import_energisation_status).toLowerCase() === 'denergised';
                    const expDen = String(r.export_energisation_status).toLowerCase() === 'denergised';
                    
                    return (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="p-3 font-medium">{r.latest_account_number_for_address}</td>
                        <td className="p-3 capitalize">{r.account_type}</td>
                        <td className={`p-3 ${staleRead ? 'text-red-600 font-bold' : ''}`}>{r.last_smart_read}</td>
                        <td className={`p-3 ${missingExport ? 'text-red-600 font-bold' : ''}`}>{r.export_mpan || 'Missing'}</td>
                        <td className="p-3">
                          {r.days_without_export}
                          {missingExport && <div className="text-[10px] text-slate-500 leading-tight mt-1">{String(r.account_type).toLowerCase() === 'customer' ? 'since ZB' : 'since creation'}</div>}
                        </td>
                        <td className={`p-3 ${impDen ? 'text-red-600 font-bold' : ''}`}>{r.import_energisation_status}</td>
                        <td className={`p-3 ${expDen ? 'text-red-600 font-bold' : ''}`}>{r.export_energisation_status}</td>
                        <td className="p-3 text-xs font-semibold text-red-600 bg-red-50/30">
                          {staleRead && <div>Stale Read (>2d)</div>}
                          {missingExport && <div>No Exp MPAN</div>}
                          {(impDen || expDen) && <div>Denergised</div>}
                        </td>
                      </tr>
                    );
                  })}
                  {metrics.meterIssues.length === 0 && <tr><td colSpan="8" className="p-6 text-center text-slate-500">No issues found.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 6: EOY Projection (Req 7) */}
        {activeTab === 'EOY Projection' && (
          <div className="bg-white border rounded-xl shadow-sm p-6">
            <div className="mb-6 border-b pb-4">
              <h2 className="text-lg font-bold text-slate-800">EOY Projected Net Import vs Allowance</h2>
              <p className="text-sm text-slate-500 mt-1">Fair use allowance is 4000kWh. Bars represent EOY Projected Net Import, sized relative to the 4000 limit limit. Inner dark bar represents progress based on `net_import_contract_ev_adjusted` according to days through contract.</p>
              
              <div className="flex gap-4 mt-4 text-xs font-medium">
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500 rounded"></span> Over 4000</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-orange-600 rounded"></span> 3500 - 4000</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-orange-400 rounded"></span> 3000 - 3500</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-500 rounded"></span> Under 3000</span>
              </div>
            </div>

            <div className="space-y-5 max-h-[600px] overflow-y-auto pr-4">
              {filteredData
                .filter(r => r.eoy_projected_net_import) // Only show rows with projection
                .sort((a,b) => parseFloat(b.eoy_projected_net_import) - parseFloat(a.eoy_projected_net_import))
                .map((row, i) => {
                  const eoy = parseFloat(row.eoy_projected_net_import) || 0;
                  const currentNet = parseFloat(row.net_import_contract_ev_adjusted) || 0;
                  
                  // Req 7: Color code logic
                  let bgColor = 'bg-emerald-500'; // Under 3000
                  if (eoy > 4000) bgColor = 'bg-red-500';
                  else if (eoy >= 3500) bgColor = 'bg-orange-600'; // Dark orange
                  else if (eoy >= 3000) bgColor = 'bg-orange-400'; // Light orange

                  // Bar scales relative to max allowance (cap at say 6000 for visual sanity, or 4000)
                  const outerWidthPct = Math.min((eoy / 4500) * 100, 100); 
                  
                  // Inner bar (current net progress relative to EOY projection)
                  let innerWidthPct = eoy > 0 ? (currentNet / eoy) * 100 : 0;
                  innerWidthPct = Math.max(0, Math.min(innerWidthPct, 100)); // Clamp 0-100

                  return (
                    <div key={i} className="flex flex-col gap-1">
                      <div className="flex justify-between items-end text-sm">
                        <span className="font-semibold text-slate-700">{row.latest_account_number_for_address}</span>
                        <div className="text-right">
                          <span className={`font-bold ${eoy > 4000 ? 'text-red-600' : 'text-slate-700'}`}>{eoy.toFixed(0)} kWh EOY</span>
                          <span className="text-xs text-slate-500 ml-2">({row.days_this_contract} days through contract)</span>
                        </div>
                      </div>
                      
                      {/* Outer container acts as the 4500kWh axis line visually */}
                      <div className="w-full h-6 bg-slate-100 rounded border border-slate-200 relative overflow-hidden">
                        {/* The EOY Projected limit bar */}
                        <div 
                          className={`h-full absolute top-0 left-0 ${bgColor} opacity-30`} 
                          style={{width: `${outerWidthPct}%`}}
                        ></div>
                        
                        {/* The Actual Current Net progress bar inside the EOY bar */}
                        <div 
                          className={`h-full absolute top-0 left-0 ${bgColor} transition-all border-r-2 border-white/50`} 
                          style={{width: `${outerWidthPct * (innerWidthPct/100)}%`}}
                          title={`Current adjusted net: ${currentNet.toFixed(0)} kWh`}
                        ></div>
                        
                        {/* 4000 Fair Use Marker */}
                        <div className="absolute top-0 bottom-0 border-l-2 border-red-500 border-dashed z-10" style={{left: `${(4000/4500)*100}%`}} title="4000 Fair Use Limit"></div>
                      </div>
                    </div>
                  );
              })}
            </div>
          </div>
        )}

      </div>

      {/* Shared Drill Down Modal */}
      <DrillDownModal />
      
    </div>
  );
}
