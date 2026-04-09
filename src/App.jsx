import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  AlertCircle, CheckCircle2, XCircle, Clock, BarChart3, 
  BatteryWarning, Zap, ChevronDown, Filter, Car, 
  Settings, Gauge, Info, Search, AlertTriangle, Battery, 
  ZapOff, Calendar, User, Building2, X, ArrowUpDown, Smile
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';

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
const getAddress = (r) => `${r.postal_number || ''} ${r.street_name || ''}`.trim();

export default function App() {
  const [data, setData] = useState([]);
  const [activeTab, setActiveTab] = useState('Overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Drilldown Modal State
  const [drillDownTitle, setDrillDownTitle] = useState('');
  const [drillDownData, setDrillDownData] = useState(null);
  const [modalSearch, setModalSearch] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

  // Missing MPANs tab specific filter
  const [mpanTypeFilter, setMpanTypeFilter] = useState('All'); 

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

    // Site Breakdown for Tab 1
    const siteBreakdownOverview = {};
    allAccounts.forEach(r => {
      const site = r.site_name || 'Unknown';
      if (!siteBreakdownOverview[site]) siteBreakdownOverview[site] = { name: site, total: 0, zb: 0, standard: 0 };
      siteBreakdownOverview[site].total++;
      if (isZeroBills(r.import_tariff)) siteBreakdownOverview[site].zb++;
      else siteBreakdownOverview[site].standard++;
    });

    // Req 3: Tariff Issues
    const tariffIssues = filteredData.filter(r => {
      const impMismatch = r.kraken_import_tariff_valid_to && r.kraken_import_tariff_valid_to !== r.agreement_valid_to;
      const expMismatch = r.kraken_export_tariff_valid_to && r.kraken_export_tariff_valid_to !== r.agreement_valid_to;
      const devWrongTariff = String(r.account_type).toLowerCase() === 'developer' && isZeroBills(r.import_tariff);
      return impMismatch || expMismatch || devWrongTariff;
    });

    // Req 4: EV
    const evConfirmed = filteredData.filter(r => isTrue(r.ev_billed));
    const evSuspected = filteredData.filter(r => isTrue(r.suspected_ev));
    const noEv = filteredData.filter(r => !isTrue(r.ev_billed) && !isTrue(r.suspected_ev));

    // Req 5: Battery (Updated to battery_signal)
    const totalBattery = filteredData.length;
    const battSetup = filteredData.filter(r => isTrue(r.battery_setup));
    const battOnline = filteredData.filter(r => isTrue(r.battery_setup) && isTrue(r.battery_signal));
    const battOffline = filteredData.filter(r => isTrue(r.battery_setup) && !isTrue(r.battery_signal));
    const battNotSetup = filteredData.filter(r => !isTrue(r.battery_setup));

    // Req 6: Missing MPANs
    const missingMpans = filteredData.filter(r => !r.export_mpan || String(r.export_mpan).toLowerCase() === 'null');

    // Req 8: Smart Reads
    const smartReadIssues = filteredData.filter(r => {
      if (!r.last_smart_read) return true; // Flag if missing entirely
      const readDate = new Date(r.last_smart_read);
      const daysOld = (today - readDate) / (1000 * 60 * 60 * 24);
      return daysOld > 2;
    });

    // Req 9: EOY Projection
    const eoyData = filteredData
      .filter(r => r.eoy_projected_net_import && r.days_this_contract && String(r.days_this_contract).toLowerCase() !== 'null')
      .sort((a,b) => parseFloat(b.eoy_projected_net_import) - parseFloat(a.eoy_projected_net_import));
    
    const avgEoy = eoyData.length > 0 ? (eoyData.reduce((acc, curr) => acc + parseFloat(curr.eoy_projected_net_import), 0) / eoyData.length) : 0;

    return {
      allAccounts, zbAccounts, stdAccounts, siteOverview: Object.values(siteBreakdownOverview).sort((a,b) => b.total - a.total),
      tariffIssues, 
      evConfirmed, evSuspected, noEv,
      totalBattery, battSetup, battOnline, battOffline, battNotSetup,
      missingMpans, smartReadIssues, eoyData, avgEoy
    };
  }, [filteredData]);

  // --- Modal Logic ---
  const handleDrillDown = (title, list) => {
    setDrillDownTitle(title);
    setDrillDownData(list);
    setModalSearch('');
    setSortConfig({ key: null, direction: 'asc' });
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const processedModalData = useMemo(() => {
    if (!drillDownData) return [];
    let processed = [...drillDownData];
    
    // Search Filter
    if (modalSearch) {
      const lowerSearch = modalSearch.toLowerCase();
      processed = processed.filter(row => 
        Object.values(row).some(val => String(val).toLowerCase().includes(lowerSearch)) ||
        getAddress(row).toLowerCase().includes(lowerSearch)
      );
    }

    // Sort
    if (sortConfig.key) {
      processed.sort((a, b) => {
        let valA = a[sortConfig.key] || '';
        let valB = b[sortConfig.key] || '';
        if (!isNaN(parseFloat(valA)) && !isNaN(parseFloat(valB))) {
          valA = parseFloat(valA); valB = parseFloat(valB);
        }
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return processed;
  }, [drillDownData, modalSearch, sortConfig]);

  const DrillDownModal = () => {
    if (!drillDownData) return null;
    
    // Hide contract info for standard tariff drilldown (Req 2)
    const isStandard = drillDownTitle.includes('Standard');

    const SortIcon = ({ colKey }) => (
      <ArrowUpDown size={12} className={`inline ml-1 ${sortConfig.key === colKey ? 'text-indigo-600' : 'text-slate-300'}`} />
    );

    return (
      <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-[95vw] max-h-[90vh] flex flex-col">
          <div className="p-4 border-b flex justify-between items-center bg-slate-50 rounded-t-xl">
            <div>
              <h2 className="text-xl font-bold text-slate-800">{drillDownTitle} <span className="text-slate-500 text-sm font-normal">({processedModalData.length} records)</span></h2>
            </div>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                <input 
                  type="text" placeholder="Search rows..." value={modalSearch} onChange={e => setModalSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 w-64"
                />
              </div>
              <button onClick={() => setDrillDownData(null)} className="p-2 hover:bg-slate-200 rounded-full transition"><X size={20}/></button>
            </div>
          </div>
          <div className="overflow-auto p-4">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="bg-slate-100 text-slate-600 sticky top-0 z-10 shadow-sm cursor-pointer">
                <tr>
                  <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('latest_account_number_for_address')}>Account <SortIcon colKey="latest_account_number_for_address"/></th>
                  <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('postal_number')}>Address <SortIcon colKey="postal_number"/></th>
                  <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('postcode')}>Postcode <SortIcon colKey="postcode"/></th>
                  <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('site_name')}>Site <SortIcon colKey="site_name"/></th>
                  <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('account_type')}>Type <SortIcon colKey="account_type"/></th>
                  <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('import_tariff')}>Import Tariff <SortIcon colKey="import_tariff"/></th>
                  <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('export_tariff')}>Export Tariff <SortIcon colKey="export_tariff"/></th>
                  
                  {!isStandard && <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('agreement_valid_from')}>Valid From <SortIcon colKey="agreement_valid_from"/></th>}
                  {!isStandard && <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('agreement_valid_to')}>Valid To <SortIcon colKey="agreement_valid_to"/></th>}
                  {!isStandard && <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('days_this_contract')}>Days (Contract) <SortIcon colKey="days_this_contract"/></th>}
                  {!isStandard && <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('days_on_tariff')}>Days (Tariff) <SortIcon colKey="days_on_tariff"/></th>}
                  
                  <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('operations_team')}>Ops Team <SortIcon colKey="operations_team"/></th>
                  <th className="p-3 text-center">PSR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {processedModalData.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="p-3 font-medium text-slate-900">{row.latest_account_number_for_address || row.import_mpans}</td>
                    <td className="p-3">{getAddress(row)}</td>
                    <td className="p-3">{row.postcode}</td>
                    <td className="p-3 font-medium">{row.site_name}</td>
                    <td className="p-3 capitalize">{row.account_type}</td>
                    <td className="p-3 max-w-[150px] truncate" title={row.import_tariff}>{row.import_tariff}</td>
                    <td className="p-3 max-w-[150px] truncate" title={row.export_tariff}>{row.export_tariff}</td>
                    
                    {!isStandard && <td className="p-3">{row.agreement_valid_from}</td>}
                    {!isStandard && <td className="p-3">{row.agreement_valid_to}</td>}
                    {!isStandard && <td className="p-3">{row.days_this_contract}</td>}
                    {!isStandard && <td className="p-3">{row.days_on_tariff}</td>}
                    
                    <td className="p-3">{row.operations_team}</td>
                    <td className="p-3 text-center">{isTrue(row.is_psr) ? '✅' : '⬜'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {processedModalData.length === 0 && <p className="text-center text-slate-500 py-8">No records match your search.</p>}
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
                      <input type="checkbox" className="rounded text-indigo-600" checked={selectedTranches.has(t)} onChange={() => {
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
                      <input type="checkbox" className="rounded text-indigo-600" checked={selectedSites.has(s)} onChange={() => {
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
          {['Overview', 'Tariff Issues', 'EV', 'Battery Issues', 'Missing MPANs', 'Smart Reads', 'EOY Projection'].map(tab => (
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
        
        {/* Tab 1: Overview (Req 1, 2, 3) */}
        {activeTab === 'Overview' && (
          <div className="space-y-6">
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

            {/* Site & Tranche Portfolio View */}
            <div className="bg-white p-6 rounded-xl border shadow-sm">
              <h3 className="font-bold text-slate-800 mb-6">Portfolio Breakdown by Site (Zero Bills vs Pending)</h3>
              <div className="h-96 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metrics.siteOverview} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} tick={{fontSize: 12}} />
                    <YAxis />
                    <RechartsTooltip 
                      formatter={(value, name) => [value, name === 'zb' ? 'Zero Bills' : 'Pending/Standard']}
                      cursor={{fill: '#f1f5f9'}}
                    />
                    <Legend verticalAlign="top" height={36}/>
                    <Bar dataKey="zb" name="Zero Bills" stackId="a" fill="#10b981" />
                    <Bar dataKey="standard" name="Pending/Standard" stackId="a" fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Tariff Issues (Req 1, 3) */}
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
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="p-3">Account</th>
                    <th className="p-3">Account Type</th>
                    <th className="p-3">Import Tariff</th>
                    <th className="p-3">Export Tariff</th>
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
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="p-3 font-medium">{r.latest_account_number_for_address}</td>
                        <td className="p-3 capitalize">{r.account_type}</td>
                        <td className="p-3 truncate max-w-[150px]" title={r.import_tariff}>{r.import_tariff}</td>
                        <td className="p-3 truncate max-w-[150px]" title={r.export_tariff}>{r.export_tariff}</td>
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
                  {metrics.tariffIssues.length === 0 && <tr><td colSpan="8" className="p-6 text-center text-slate-500">No issues found.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: EV (Req 4) */}
        {activeTab === 'EV' && (
          <div className="bg-white border rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2"><Car className="text-indigo-500"/> EV Portfolio Status</h2>
            <p className="text-sm text-slate-500 mb-6">Click on any bar to see the list of accounts in that segment.</p>
            
            <div className="h-96 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  data={[
                    { name: 'Confirmed EVs', value: metrics.evConfirmed.length, list: metrics.evConfirmed, fill: '#10b981' },
                    { name: 'Suspected EVs', value: metrics.evSuspected.length, list: metrics.evSuspected, fill: '#f59e0b' },
                    { name: 'No EV Suspected', value: metrics.noEv.length, list: metrics.noEv, fill: '#94a3b8' }
                  ]}
                  margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{fontSize: 14, fontWeight: 500}} />
                  <YAxis />
                  <RechartsTooltip cursor={{fill: '#f1f5f9'}} formatter={(val) => [`${val} Accounts`, 'Total']} />
                  <Bar 
                    dataKey="value" 
                    onClick={(data) => handleDrillDown(data.payload.name, data.payload.list)}
                    cursor="pointer"
                  >
                    {
                      [metrics.evConfirmed, metrics.evSuspected, metrics.noEv].map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={['#10b981', '#f59e0b', '#94a3b8'][index]} />
                      ))
                    }
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Tab 4: Battery Issues (Req 5) */}
        {activeTab === 'Battery Issues' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-white p-4 rounded-xl border shadow-sm flex flex-col justify-center items-center">
                <span className="text-slate-500 text-xs font-bold uppercase">Total Accounts</span>
                <span className="text-2xl font-bold text-slate-900">{metrics.totalBattery}</span>
              </div>
              <div onClick={() => handleDrillDown('Batteries Setup', metrics.battSetup)} className="bg-white p-4 rounded-xl border border-indigo-200 shadow-sm flex flex-col justify-center items-center cursor-pointer hover:bg-indigo-50">
                <span className="text-indigo-600 text-xs font-bold uppercase">Setup</span>
                <span className="text-2xl font-bold text-indigo-700">{metrics.battSetup.length}</span>
              </div>
              <div onClick={() => handleDrillDown('Batteries Online', metrics.battOnline)} className="bg-white p-4 rounded-xl border border-emerald-200 shadow-sm flex flex-col justify-center items-center cursor-pointer hover:bg-emerald-50">
                <span className="text-emerald-600 text-xs font-bold uppercase">Online (Signal OK)</span>
                <span className="text-2xl font-bold text-emerald-700">{metrics.battOnline.length}</span>
              </div>
              <div onClick={() => handleDrillDown('Batteries Offline', metrics.battOffline)} className="bg-white p-4 rounded-xl border border-red-200 shadow-sm flex flex-col justify-center items-center cursor-pointer hover:bg-red-50">
                <span className="text-red-600 text-xs font-bold uppercase">Setup but Offline</span>
                <span className="text-2xl font-bold text-red-700">{metrics.battOffline.length}</span>
              </div>
              <div onClick={() => handleDrillDown('Batteries Not Setup', metrics.battNotSetup)} className="bg-white p-4 rounded-xl border border-slate-300 shadow-sm flex flex-col justify-center items-center cursor-pointer hover:bg-slate-100">
                <span className="text-slate-600 text-xs font-bold uppercase">Not Setup</span>
                <span className="text-2xl font-bold text-slate-700">{metrics.battNotSetup.length}</span>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border shadow-sm overflow-hidden flex flex-col">
              <h3 className="font-bold text-slate-800 mb-4">Accounts Requiring Attention (Offline or Not Setup)</h3>
              <div className="overflow-auto border border-slate-100 rounded-lg max-h-96">
                <table className="w-full text-xs text-left whitespace-nowrap">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0 shadow-sm">
                    <tr>
                      <th className="p-3">Account</th>
                      <th className="p-3">Site</th>
                      <th className="p-3">Status</th>
                      <th className="p-3" title="Days still without battery setup">Days w/o Setup</th>
                      <th className="p-3" title="Days without setup in past (for online)">Past Days w/o Setup</th>
                      <th className="p-3" title="% without setup">% Time w/o Setup</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredData.filter(r => !isTrue(r.battery_setup) || !isTrue(r.battery_signal)).map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="p-3 font-medium">{r.latest_account_number_for_address}</td>
                        <td className="p-3">{r.site_name}</td>
                        <td className="p-3 font-semibold">
                          {!isTrue(r.battery_setup) ? <span className="text-slate-500">Not Setup</span> : <span className="text-red-600">Offline</span>}
                        </td>
                        <td className="p-3 text-red-600 font-bold">{r.days_still_without_battery_setup}</td>
                        <td className="p-3">{r.days_without_battery_setup_past}</td>
                        <td className="p-3">{r.without_battery_setup_percentage ? `${parseFloat(r.without_battery_setup_percentage).toFixed(1)}%` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: Missing MPANs (Req 6) */}
        {activeTab === 'Missing MPANs' && (
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="p-6 border-b flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">Accounts Missing Export MPAN</h2>
              
              <div className="flex gap-2">
                <select 
                  value={mpanTypeFilter} 
                  onChange={e => setMpanTypeFilter(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="All">All Types</option>
                  <option value="Developer">Developer Only</option>
                  <option value="Customer">Customer Only</option>
                </select>
                <button onClick={() => handleDrillDown('All Missing MPANs', metrics.missingMpans)} className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm hover:bg-slate-50">View Full Extracted List</button>
              </div>
            </div>
            
            <div className="overflow-x-auto p-4">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="p-3">Account</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Import Energisation</th>
                    <th className="p-3">Export Energisation</th>
                    <th className="p-3 bg-red-50">Detected Issues</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {metrics.missingMpans
                    .filter(r => mpanTypeFilter === 'All' || String(r.account_type).toLowerCase() === mpanTypeFilter.toLowerCase())
                    .map((r, i) => {
                      const impDen = String(r.import_energisation_status).toLowerCase() === 'denergised';
                      const expDen = String(r.export_energisation_status).toLowerCase() === 'denergised';
                      return (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="p-3 font-medium">{r.latest_account_number_for_address}</td>
                          <td className="p-3 capitalize">{r.account_type}</td>
                          <td className={`p-3 ${impDen ? 'text-red-600 font-bold' : ''}`}>{r.import_energisation_status}</td>
                          <td className={`p-3 ${expDen ? 'text-red-600 font-bold' : ''}`}>{r.export_energisation_status}</td>
                          <td className="p-3 text-xs font-semibold text-red-600 bg-red-50/30">
                            <div>Missing Export MPAN</div>
                            {(impDen || expDen) && <div>Denergised Status detected</div>}
                          </td>
                        </tr>
                      );
                  })}
                  {metrics.missingMpans.length === 0 && <tr><td colSpan="5" className="p-6 text-center text-slate-500">All accounts have an Export MPAN.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 6: Smart Reads (Req 8) */}
        {activeTab === 'Smart Reads' && (
          <div className="bg-white border rounded-xl shadow-sm p-6">
             <div className="mb-6 flex justify-between items-center border-b pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Stale Smart Reads (> 2 Days Old)</h2>
                <p className="text-sm text-slate-500 mt-1">Checking 'last_smart_read' to ensure active communications.</p>
              </div>
            </div>

            {metrics.smartReadIssues.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-emerald-600 bg-emerald-50 rounded-xl border border-emerald-100">
                <Smile size={64} className="mb-4 text-emerald-500"/>
                <h2 className="text-2xl font-bold">All meters online!</h2>
                <p className="text-emerald-700/80 mt-2">No smart reads are older than 2 days.</p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-100 rounded-lg">
                <table className="w-full text-sm text-left whitespace-nowrap">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="p-3">Account</th>
                      <th className="p-3">Site</th>
                      <th className="p-3">Last Smart Read Date</th>
                      <th className="p-3 text-red-600">Days Stale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {metrics.smartReadIssues.map((r, i) => {
                      const readDate = new Date(r.last_smart_read);
                      const daysOld = r.last_smart_read ? Math.floor((new Date() - readDate) / (1000 * 60 * 60 * 24)) : 'Missing completely';
                      return (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="p-3 font-medium">{r.latest_account_number_for_address}</td>
                          <td className="p-3">{r.site_name}</td>
                          <td className="p-3 font-semibold">{r.last_smart_read || 'N/A'}</td>
                          <td className="p-3 text-red-600 font-bold">{daysOld}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 7: EOY Projection (Req 9) */}
        {activeTab === 'EOY Projection' && (
          <div className="bg-white border rounded-xl shadow-sm p-6">
            <div className="mb-6 border-b pb-4 flex flex-col md:flex-row justify-between md:items-end gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800">EOY Projected Net Import vs Allowance</h2>
                <p className="text-sm text-slate-500 mt-1">Highest to lowest. Null contract days excluded. Inner bar shows current progress.</p>
                <div className="flex gap-4 mt-4 text-xs font-medium">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500 rounded"></span> Over 4000</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-orange-600 rounded"></span> 3500 - 4000</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-orange-400 rounded"></span> 3000 - 3500</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-500 rounded"></span> Under 3000</span>
                </div>
              </div>
              <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg text-center">
                <div className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Portfolio Average EOY</div>
                <div className="text-2xl font-black text-indigo-600">{metrics.avgEoy.toFixed(0)} <span className="text-sm text-slate-500 font-normal">kWh</span></div>
              </div>
            </div>

            <div className="space-y-5 max-h-[600px] overflow-y-auto pr-4">
              {metrics.eoyData.map((row, i) => {
                  const eoy = parseFloat(row.eoy_projected_net_import) || 0;
                  const currentNet = parseFloat(row.net_import_contract_ev_adjusted) || 0;
                  
                  let bgColor = 'bg-emerald-500'; 
                  if (eoy > 4000) bgColor = 'bg-red-500';
                  else if (eoy >= 3500) bgColor = 'bg-orange-600'; 
                  else if (eoy >= 3000) bgColor = 'bg-orange-400'; 

                  const outerWidthPct = Math.min((eoy / 4500) * 100, 100); 
                  let innerWidthPct = eoy > 0 ? (currentNet / eoy) * 100 : 0;
                  innerWidthPct = Math.max(0, Math.min(innerWidthPct, 100)); 

                  return (
                    <div key={i} className="flex flex-col gap-1">
                      <div className="flex justify-between items-end text-sm">
                        <span className="font-semibold text-slate-700">{row.latest_account_number_for_address}</span>
                        <div className="text-right">
                          <span className={`font-bold ${eoy > 4000 ? 'text-red-600' : 'text-slate-700'}`}>{eoy.toFixed(0)} kWh EOY</span>
                          <span className="text-xs text-slate-500 ml-2">({row.days_this_contract} days through contract)</span>
                        </div>
                      </div>
                      
                      <div className="w-full h-6 bg-slate-100 rounded border border-slate-200 relative overflow-hidden">
                        <div className={`h-full absolute top-0 left-0 ${bgColor} opacity-30`} style={{width: `${outerWidthPct}%`}}></div>
                        <div className={`h-full absolute top-0 left-0 ${bgColor} transition-all border-r-2 border-white/50`} style={{width: `${outerWidthPct * (innerWidthPct/100)}%`}} title={`Current adjusted net: ${currentNet.toFixed(0)} kWh`}></div>
                        <div className="absolute top-0 bottom-0 border-l-2 border-red-500 border-dashed z-10" style={{left: `${(4000/4500)*100}%`}} title="4000 Fair Use Limit"></div>
                      </div>
                    </div>
                  );
              })}
            </div>
          </div>
        )}

      </div>

      <DrillDownModal />
    </div>
  );
}
