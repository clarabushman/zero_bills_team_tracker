import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  AlertCircle, CheckCircle2, XCircle, Clock, BarChart3, 
  BatteryWarning, Zap, ChevronDown, Filter, Car, 
  Settings, Gauge, Info, Search, AlertTriangle, Battery, 
  ZapOff, Calendar, User, Building2, X, ArrowUpDown, Smile, MapPin,
  Download
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';

// --- Utilities & Configuration ---
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

// Safely clean numbers with commas before parsing
const parseCleanNumber = (val) => {
    if (val === null || val === undefined) return 0;
    const parsed = parseFloat(String(val).replace(/,/g, ''));
    return isNaN(parsed) ? 0 : parsed;
};

const isZeroBills = (tariff) => String(tariff || '').toLowerCase().includes('zero');
const isTrue = (val) => String(val).toUpperCase() === 'TRUE';
const getAddress = (r) => `${r.postal_number || ''} ${r.street_name || ''}`.trim();

// Stale date checker with UK date handling and strict midnight calendar math
const isDateStale = (dateStr) => {
    if (!dateStr || String(dateStr).trim().toLowerCase() === 'null' || String(dateStr).trim() === '') return true;
    
    let safeDateStr = String(dateStr).trim();
    if (safeDateStr.includes('/')) {
        const parts = safeDateStr.split(/[ /]/);
        if (parts.length === 3 && parts[2].length === 4) {
            safeDateStr = `${parts[2]}-${parts[1]}-${parts[0]}`; 
        }
    }
    
    const readDate = new Date(safeDateStr);
    if (isNaN(readDate.getTime())) return true; 

    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    readDate.setHours(0, 0, 0, 0);

    const daysOld = Math.floor((currentDate.getTime() - readDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysOld > 3; 
}

// Robust MPAN Checker
const hasValidMpan = (val1, val2) => {
    const check = (v) => v && String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'null';
    return check(val1) || check(val2);
};

// CSV Exporter for Modals
const exportToCSV = (dataList, filename) => {
    if (!dataList || !dataList.length) return;
    const headers = Object.keys(dataList[0]);
    const csvRows = [headers.join(',')];
    for (const row of dataList) {
        const values = headers.map(header => {
            const val = row[header] === null || row[header] === undefined ? '' : String(row[header]);
            return `"${val.replace(/"/g, '""')}"`; // Escape quotes inside values
        });
        csvRows.push(values.join(','));
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

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

  // Tab-Specific Filters & Search States
  const [mpanTypeFilter, setMpanTypeFilter] = useState('All'); 
  const [eoySearchQuery, setEoySearchQuery] = useState('');
  const [eoySortBy, setEoySortBy] = useState('usage_desc');
  
  // Search States
  const [batteryProblemSearch, setBatteryProblemSearch] = useState('');
  const [batteryProblemSort, setBatteryProblemSort] = useState({ key: 'derived_days_issue', direction: 'desc' });
  
  const [batterySiteSearch, setBatterySiteSearch] = useState('');
  const [missingMpanSearch, setMissingMpanSearch] = useState('');
  const [missingSmartReadsSearch, setMissingSmartReadsSearch] = useState('');

  // Global Portfolio Filters
  const [selectedTranches, setSelectedTranches] = useState(new Set());
  const [selectedSites, setSelectedSites] = useState(new Set());
  const [tariffStatusFilter, setTariffStatusFilter] = useState('All'); 
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
          rawHeaders.forEach((h, i) => {
              let val = row[i]?.trim();
              if (h === 'tranche' && (!val || val.toLowerCase() === 'null')) {
                  val = 'Not on Tariff';
              }
              obj[h] = val;
          });
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
      
      const onTariff = isZeroBills(row.import_tariff);
      const matchTariff = tariffStatusFilter === 'All' ? true : 
                          tariffStatusFilter === 'On Tariff' ? onTariff : 
                          !onTariff;

      return matchTranche && matchSite && matchTariff;
    });
  }, [data, selectedTranches, selectedSites, tariffStatusFilter]);

  const filterOptions = useMemo(() => {
    const tranches = [...new Set(data.map(r => r.tranche))].filter(Boolean).sort();
    const sites = [...new Set(data.map(r => r.site_name))].filter(Boolean).sort();
    return { tranches, sites };
  }, [data]);

  // --- Metrics Calculations ---
  const metrics = useMemo(() => {
    const allAccounts = filteredData.filter(r => r.latest_account_number_for_address || r.import_mpans);
    const zbAccounts = allAccounts.filter(r => isZeroBills(r.import_tariff));
    const stdAccounts = allAccounts.filter(r => r.import_tariff && !isZeroBills(r.import_tariff));

    const siteBreakdownOverview = {};
    allAccounts.forEach(r => {
      const site = r.site_name || 'Unknown';
      if (!siteBreakdownOverview[site]) siteBreakdownOverview[site] = { name: site, total: 0, zb: 0, pending: 0, zbData: [], pendingData: [] };
      siteBreakdownOverview[site].total++;
      if (isZeroBills(r.import_tariff)) {
        siteBreakdownOverview[site].zb++;
        siteBreakdownOverview[site].zbData.push(r);
      } else {
        siteBreakdownOverview[site].pending++;
        siteBreakdownOverview[site].pendingData.push(r);
      }
    });

    const tariffIssues = filteredData.filter(r => {
      const impMismatch = r.kraken_import_tariff_valid_to && r.kraken_import_tariff_valid_to !== r.agreement_valid_to;
      const expMismatch = r.kraken_export_tariff_valid_to && r.kraken_export_tariff_valid_to !== r.agreement_valid_to;
      const devWrongTariff = String(r.account_type).toLowerCase() === 'developer' && isZeroBills(r.import_tariff);
      return impMismatch || expMismatch || devWrongTariff;
    });

    const evConfirmed = filteredData.filter(r => isTrue(r.ev_billed));
    const evSuspected = filteredData.filter(r => isTrue(r.suspected_ev));
    const noEv = filteredData.filter(r => !isTrue(r.ev_billed) && !isTrue(r.suspected_ev));

    const totalBattery = filteredData.length;
    const battSetup = filteredData.filter(r => isTrue(r.battery_setup));
    const battOnline = filteredData.filter(r => isTrue(r.battery_setup) && isTrue(r.battery_signal));
    const battOffline = filteredData.filter(r => isTrue(r.battery_setup) && !isTrue(r.battery_signal));
    const battNotSetup = filteredData.filter(r => !isTrue(r.battery_setup));

    const batterySiteSummary = {};
    filteredData.forEach(r => {
        const site = r.site_name || 'Unknown';
        if (!batterySiteSummary[site]) {
            batterySiteSummary[site] = { 
                name: site, 
                company: r.company || 'N/A Company',
                tranche: r.tranche || 'Not on Tariff',
                total: 0, online: 0, offline: 0, notSetup: 0, 
                totalSetupDelay: 0, totalOfflineDays: 0,
                onlineData: [], offlineData: [], notSetupData: [] 
            };
        }
        
        batterySiteSummary[site].total++;
        
        const setupDelay = parseCleanNumber(r.days_still_without_battery_setup) + parseCleanNumber(r.days_without_battery_setup_past);
        const offlineDays = parseCleanNumber(r.days_offline);
        
        batterySiteSummary[site].totalSetupDelay += setupDelay;
        batterySiteSummary[site].totalOfflineDays += offlineDays;

        if (isTrue(r.battery_setup)) {
            if (isTrue(r.battery_signal)) {
                batterySiteSummary[site].online++;
                batterySiteSummary[site].onlineData.push(r);
            } else {
                batterySiteSummary[site].offline++;
                batterySiteSummary[site].offlineData.push(r);
            }
        } else {
            batterySiteSummary[site].notSetup++;
            batterySiteSummary[site].notSetupData.push(r);
        }
    });

    const siteDelayData = Object.values(batterySiteSummary).map(site => ({
        ...site,
        avgSetupDelay: parseFloat((site.totalSetupDelay / site.total).toFixed(1)),
        avgOfflineDays: parseFloat((site.totalOfflineDays / site.total).toFixed(1))
    }))
    .filter(s => s.avgSetupDelay > 0 || s.avgOfflineDays > 0)
    .sort((a,b) => (b.avgSetupDelay + b.avgOfflineDays) - (a.avgSetupDelay + a.avgOfflineDays))
    .slice(0, 25);

    // Derived fields for easy sorting in Problematic Accounts
    const batteryProblemAccounts = filteredData.filter(r => !isTrue(r.battery_setup) || !isTrue(r.battery_signal)).map(r => {
        const isNotSetup = !isTrue(r.battery_setup);
        const isOffline = isTrue(r.battery_setup) && !isTrue(r.battery_signal);
        return {
            ...r,
            derived_status: isNotSetup ? 'Not Setup' : 'Offline',
            derived_days_issue: isNotSetup ? parseCleanNumber(r.days_still_without_battery_setup) : (isOffline ? parseCleanNumber(r.days_offline) : 0),
            derived_past_setup_delay: parseCleanNumber(r.days_without_battery_setup_past),
            is_zero_readings: String(r.days_offline_percentage).includes('100% (Zero Readings)') ? 1 : 0
        };
    });

    const pastBatteryDelays = filteredData.filter(r => {
        const pastDays = String(r.days_without_battery_setup_past || '').trim().toLowerCase();
        return pastDays && pastDays !== 'null' && pastDays !== '0';
    }).sort((a,b) => parseFloat(b.days_without_battery_setup_past) - parseFloat(a.days_without_battery_setup_past));

    const missingMpans = filteredData.filter(r => !r.export_mpan || String(r.export_mpan).toLowerCase() === 'null');

    const missingSmartReads = filteredData.filter(r => {
        const hasImport = hasValidMpan(r.import_mpans, r.import_mpan);
        const hasExport = hasValidMpan(r.export_mpans, r.export_mpan);

        const impStale = hasImport ? isDateStale(r.import_last_smart_read_date) : false;
        const expStale = hasExport ? isDateStale(r.export_last_smart_read_date) : false;

        return impStale || expStale;
    });

    const eoyDataRaw = filteredData.filter(r => 
        r.eoy_projected_net_import && 
        parseCleanNumber(r.eoy_projected_net_import) !== 0 && 
        r.days_this_contract && 
        String(r.days_this_contract).toLowerCase() !== 'null'
    );
    
    // EOY Site Summary for Average Graph
    const eoySiteMap = {};
    eoyDataRaw.forEach(r => {
        const site = r.site_name || 'Unknown';
        if (!eoySiteMap[site]) {
            eoySiteMap[site] = { name: site, totalEoy: 0, count: 0, accounts: [] };
        }
        eoySiteMap[site].totalEoy += parseCleanNumber(r.eoy_projected_net_import);
        eoySiteMap[site].count++;
        eoySiteMap[site].accounts.push({
            ...r,
            derived_account: r.latest_account_number_for_address || r.import_mpans,
            derived_proj_eoy: parseCleanNumber(r.eoy_projected_net_import),
            derived_current_net: parseCleanNumber(r.net_import_contract) || parseCleanNumber(r.net_import_contract_ev_adjusted) || 0,
            derived_days_on_tariff: r.days_on_tariff || r.days_this_contract
        });
    });
    
    const eoySiteSummary = Object.values(eoySiteMap).map(s => ({
        name: s.name,
        avgEoy: parseFloat((s.totalEoy / s.count).toFixed(0)),
        accounts: s.accounts
    })).sort((a,b) => b.avgEoy - a.avgEoy);

    const validEoyForAvg = filteredData.filter(r => 
        r.eoy_projected_net_import && 
        String(r.eoy_projected_net_import).toLowerCase() !== 'null' && 
        parseCleanNumber(r.eoy_projected_net_import) !== 0
    );
    
    const avgEoy = validEoyForAvg.length > 0 
        ? (validEoyForAvg.reduce((acc, curr) => acc + parseCleanNumber(curr.eoy_projected_net_import), 0) / validEoyForAvg.length) 
        : 0;

    return {
      allAccounts, zbAccounts, stdAccounts, siteOverview: Object.values(siteBreakdownOverview).sort((a,b) => b.total - a.total),
      tariffIssues, 
      evConfirmed, evSuspected, noEv,
      totalBattery, battSetup, battOnline, battOffline, battNotSetup,
      batterySiteSummary: Object.values(batterySiteSummary).sort((a,b) => b.total - a.total),
      siteDelayData,
      batteryProblemAccounts, pastBatteryDelays,
      missingMpans, missingSmartReads, eoyData: eoyDataRaw, eoySiteSummary, avgEoy
    };
  }, [filteredData]);


  // --- EOY Projection Searching & Sorting ---
  const processedEoyData = useMemo(() => {
    let processed = [...metrics.eoyData];

    if (eoySearchQuery) {
        const lowerSearch = eoySearchQuery.toLowerCase();
        processed = processed.filter(row => {
            const accNum = String(row.latest_account_number_for_address || '').toLowerCase();
            const mpanNum = String(row.import_mpans || '').toLowerCase();
            return accNum.includes(lowerSearch) || mpanNum.includes(lowerSearch);
        });
    }

    if (eoySortBy === 'usage_desc') {
        processed.sort((a, b) => parseCleanNumber(b.eoy_projected_net_import) - parseCleanNumber(a.eoy_projected_net_import));
    } else if (eoySortBy === 'usage_asc') {
        processed.sort((a, b) => parseCleanNumber(a.eoy_projected_net_import) - parseCleanNumber(b.eoy_projected_net_import));
    } else if (eoySortBy === 'days_desc') {
        processed.sort((a, b) => parseCleanNumber(b.days_this_contract) - parseCleanNumber(a.days_this_contract));
    } else if (eoySortBy === 'days_asc') {
        processed.sort((a, b) => parseCleanNumber(a.days_this_contract) - parseCleanNumber(b.days_this_contract));
    }

    return processed;
  }, [metrics.eoyData, eoySearchQuery, eoySortBy]);


  // --- Specific Tab Filters ---
  const filteredBatterySites = useMemo(() => {
      if (!batterySiteSearch) return metrics.batterySiteSummary;
      return metrics.batterySiteSummary.filter(s => s.name.toLowerCase().includes(batterySiteSearch.toLowerCase()));
  }, [metrics.batterySiteSummary, batterySiteSearch]);

  const sortedAndFilteredBatteryProblems = useMemo(() => {
      let data = [...metrics.batteryProblemAccounts];
      
      if (batteryProblemSearch) {
          data = data.filter(r => String(r.latest_account_number_for_address || '').toLowerCase().includes(batteryProblemSearch.toLowerCase()));
      }
      
      if (batteryProblemSort.key) {
          data.sort((a, b) => {
              let valA = a[batteryProblemSort.key] || '';
              let valB = b[batteryProblemSort.key] || '';
              
              if (['derived_days_issue', 'derived_past_setup_delay', 'is_zero_readings'].includes(batteryProblemSort.key)) {
                  valA = parseFloat(valA) || 0;
                  valB = parseFloat(valB) || 0;
              } else {
                  valA = String(valA).toLowerCase();
                  valB = String(valB).toLowerCase();
              }
              
              if (valA < valB) return batteryProblemSort.direction === 'asc' ? -1 : 1;
              if (valA > valB) return batteryProblemSort.direction === 'asc' ? 1 : -1;
              return 0;
          });
      }
      
      return data;
  }, [metrics.batteryProblemAccounts, batteryProblemSearch, batteryProblemSort]);

  const handleProblemSort = (key) => {
      let direction = 'asc';
      if (batteryProblemSort.key === key && batteryProblemSort.direction === 'asc') direction = 'desc';
      setBatteryProblemSort({ key, direction });
  };
  
  const ProblemSortIcon = ({ colKey }) => (
      <ArrowUpDown size={12} className={`inline ml-1 cursor-pointer hover:text-indigo-800 ${batteryProblemSort.key === colKey ? 'text-indigo-600' : 'text-slate-300'}`} />
  );

  const filteredMissingMpans = useMemo(() => {
      let data = metrics.missingMpans.filter(r => mpanTypeFilter === 'All' || String(r.account_type).toLowerCase() === mpanTypeFilter.toLowerCase());
      if (missingMpanSearch) {
          data = data.filter(r => String(r.latest_account_number_for_address || '').toLowerCase().includes(missingMpanSearch.toLowerCase()));
      }
      return data;
  }, [metrics.missingMpans, mpanTypeFilter, missingMpanSearch]);

  const filteredMissingSmartReads = useMemo(() => {
      if (!missingSmartReadsSearch) return metrics.missingSmartReads;
      return metrics.missingSmartReads.filter(r => String(r.latest_account_number_for_address || '').toLowerCase().includes(missingSmartReadsSearch.toLowerCase()));
  }, [metrics.missingSmartReads, missingSmartReadsSearch]);


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
    
    if (modalSearch) {
      const lowerSearch = modalSearch.toLowerCase();
      processed = processed.filter(row => 
        Object.values(row).some(val => String(val).toLowerCase().includes(lowerSearch)) ||
        getAddress(row).toLowerCase().includes(lowerSearch)
      );
    }

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
    
    const isStandardOverview = drillDownTitle.includes('Standard Accounts');
    const isTotalOverview = drillDownTitle.includes('All Accounts');
    const hideContractInfo = isStandardOverview || isTotalOverview;
    const isEoyBreakdown = drillDownTitle.includes('EOY Average');

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
              <button onClick={() => exportToCSV(processedModalData, `${drillDownTitle.replace(/\s+/g, '_')}.csv`)} className="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition flex items-center gap-2 text-sm font-semibold border border-indigo-200">
                <Download size={16}/> Export CSV
              </button>
              <button onClick={() => setDrillDownData(null)} className="p-2 hover:bg-slate-200 rounded-full transition ml-2"><X size={20}/></button>
            </div>
          </div>
          <div className="overflow-auto p-4 flex-1">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="bg-slate-100 text-slate-600 sticky top-0 z-10 shadow-sm cursor-pointer">
                <tr>
                  {isEoyBreakdown ? (
                      <>
                        <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('derived_account')}>Account / MPAN <SortIcon colKey="derived_account"/></th>
                        <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('site_name')}>Site <SortIcon colKey="site_name"/></th>
                        <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('derived_proj_eoy')}>Projected EOY Net Import <SortIcon colKey="derived_proj_eoy"/></th>
                        <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('derived_current_net')}>Current Net Import <SortIcon colKey="derived_current_net"/></th>
                        <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('derived_days_on_tariff')}>Days on Tariff <SortIcon colKey="derived_days_on_tariff"/></th>
                      </>
                  ) : (
                      <>
                        <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('latest_account_number_for_address')}>Account / MPAN <SortIcon colKey="latest_account_number_for_address"/></th>
                        <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('postal_number')}>Address <SortIcon colKey="postal_number"/></th>
                        <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('postcode')}>Postcode <SortIcon colKey="postcode"/></th>
                        <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('site_name')}>Site <SortIcon colKey="site_name"/></th>
                        <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('account_type')}>Type <SortIcon colKey="account_type"/></th>
                        <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('import_tariff')}>Import Tariff <SortIcon colKey="import_tariff"/></th>
                        <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('export_tariff')}>Export Tariff <SortIcon colKey="export_tariff"/></th>
                        
                        {!hideContractInfo && <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('agreement_valid_from')}>Valid From <SortIcon colKey="agreement_valid_from"/></th>}
                        {!hideContractInfo && <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('agreement_valid_to')}>Valid To <SortIcon colKey="agreement_valid_to"/></th>}
                        {!hideContractInfo && <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('days_this_contract')}>Days (Contract) <SortIcon colKey="days_this_contract"/></th>}
                        {!hideContractInfo && <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('days_on_tariff')}>Days (Tariff) <SortIcon colKey="days_on_tariff"/></th>}
                        
                        <th className="p-3 hover:bg-slate-200" onClick={() => handleSort('operations_team')}>Ops Team <SortIcon colKey="operations_team"/></th>
                        <th className="p-3 text-center">PSR</th>
                      </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 flex-1">
                {processedModalData.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {isEoyBreakdown ? (
                        <>
                            <td className="p-3 font-medium text-slate-900">{row.derived_account}</td>
                            <td className="p-3 font-medium">{row.site_name}</td>
                            <td className="p-3 font-bold text-indigo-600">{row.derived_proj_eoy} kWh</td>
                            <td className="p-3 font-semibold text-slate-600">{row.derived_current_net} kWh</td>
                            <td className="p-3">{row.derived_days_on_tariff}</td>
                        </>
                    ) : (
                        <>
                            <td className="p-3 font-medium text-slate-900">{row.latest_account_number_for_address || row.import_mpans}</td>
                            <td className="p-3">{getAddress(row)}</td>
                            <td className="p-3">{row.postcode}</td>
                            <td className="p-3 font-medium">{row.site_name}</td>
                            <td className="p-3 capitalize">{row.account_type}</td>
                            <td className="p-3 max-w-[150px] truncate" title={row.import_tariff}>{row.import_tariff}</td>
                            <td className="p-3 max-w-[150px] truncate" title={row.export_tariff}>{row.export_tariff}</td>
                            
                            {!hideContractInfo && <td className="p-3">{row.agreement_valid_from}</td>}
                            {!hideContractInfo && <td className="p-3">{row.agreement_valid_to}</td>}
                            {!hideContractInfo && <td className="p-3">{row.days_this_contract}</td>}
                            {!hideContractInfo && <td className="p-3">{row.days_on_tariff}</td>}
                            
                            <td className="p-3">{row.operations_team}</td>
                            <td className="p-3 text-center">{isTrue(row.is_psr) ? '✅' : '⬜'}</td>
                        </>
                    )}
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

            <select 
              value={tariffStatusFilter} 
              onChange={e => setTariffStatusFilter(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none font-medium text-slate-700"
            >
              <option value="All">All Tariffs</option>
              <option value="On Tariff">On Tariff (Zero Bills)</option>
              <option value="Not on Tariff">Not on Tariff</option>
            </select>
            
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
          {['Overview', 'Tariff Issues', 'EV', 'Battery Issues', 'Missing MPANs', 'Missing Smart Reads', 'EOY Projection'].map(tab => (
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
        
        {/* Tab 1: Overview */}
        {activeTab === 'Overview' && (
          <div className="space-y-6">
            
            <div className="flex justify-end">
              <a 
                href="/data.csv" 
                download="data.csv" 
                className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition shadow-sm text-sm font-semibold"
              >
                <Download size={16} /> Download Raw Data (CSV)
              </a>
            </div>

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

            <div className="bg-white p-6 rounded-xl border shadow-sm">
                <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2"><MapPin className="text-indigo-500"/> Site Breakdown (Progress to Zero Bills)</h3>
                <div className="space-y-5 max-h-96 overflow-y-auto pr-4">
                    {metrics.siteOverview.map((site, i) => {
                        const zbProgress = (site.zb / site.total) * 100 || 0;
                        return (
                            <div key={i} className="flex flex-col gap-1">
                                <div className="flex justify-between text-sm items-end">
                                    <span className="font-bold text-slate-700 truncate max-w-[50%]">{site.name}</span>
                                    <span className="text-slate-500">
                                        <span className="text-emerald-600 font-medium">{zbProgress.toFixed(0)}% Zero Bills</span> 
                                        {' '}({site.total} homes)
                                    </span>
                                </div>
                                <div className="w-full h-5 flex rounded-md overflow-hidden bg-slate-100 cursor-pointer shadow-inner">
                                    <div 
                                        className="bg-emerald-500 hover:opacity-80 transition" 
                                        style={{width: `${(site.zb/site.total)*100}%`}} 
                                        title={`${site.zb} Zero Bills`}
                                        onClick={() => handleDrillDown(`${site.name} - Zero Bills`, site.zbData)}
                                    ></div>
                                    <div 
                                        className="bg-orange-500 hover:opacity-80 transition" 
                                        style={{width: `${(site.pending/site.total)*100}%`}} 
                                        title={`${site.pending} Pending/Standard`}
                                        onClick={() => handleDrillDown(`${site.name} - Pending/Standard`, site.pendingData)}
                                    ></div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
          </div>
        )}

        {/* Tab 2: Tariff Issues */}
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
                    <th className="p-3">Account / MPAN</th>
                    <th className="p-3">Account Type</th>
                    <th className="p-3">Address</th>
                    <th className="p-3">Import Tariff</th>
                    <th className="p-3">Export Tariff</th>
                    <th className="p-3">Agreement Valid To</th>
                    <th className="p-3">Kraken Import To</th>
                    <th className="p-3">Kraken Export To</th>
                    <th className="p-3">Issue Flag</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 flex-1">
                  {metrics.tariffIssues.map((r, i) => {
                    const devWrong = String(r.account_type).toLowerCase() === 'developer' && isZeroBills(r.import_tariff);
                    const impMismatch = r.kraken_import_tariff_valid_to && r.kraken_import_tariff_valid_to !== r.agreement_valid_to;
                    const expMismatch = r.kraken_export_tariff_valid_to && r.kraken_export_tariff_valid_to !== r.agreement_valid_to;
                    return (
                      <tr key={i} className="hover:bg-slate-50 flex-1">
                        <td className="p-3 font-medium text-slate-900">{r.latest_account_number_for_address || r.import_mpans}</td>
                        <td className="p-3 capitalize">{r.account_type}</td>
                        <td className="p-3">{getAddress(r)}</td>
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
                  {metrics.tariffIssues.length === 0 && <tr><td colSpan="9" className="p-6 text-center text-slate-500">No issues found.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: EV */}
        {activeTab === 'EV' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <div className="bg-white border rounded-xl shadow-sm p-6">
                <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2"><Car className="text-indigo-500"/> EV User Breakdown</h2>
                <div className="h-72 w-full cursor-pointer">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie 
                                data={[
                                    { name: 'Confirmed EVs', value: metrics.evConfirmed.length, list: metrics.evConfirmed },
                                    { name: 'Suspected EVs', value: metrics.evSuspected.length, list: metrics.evSuspected },
                                    { name: 'No EV Suspected', value: metrics.noEv.length, list: metrics.noEv }
                                ]}
                                cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={5} dataKey="value"
                                label={({ payload, cx, x, y, textAnchor }) => (
                                    <text x={x} y={y} cx={cx} textAnchor={textAnchor} dominantBaseline="central" className="text-xs font-semibold fill-slate-700">
                                      {payload.value}
                                    </text>
                                  )}
                                onClick={(data) => handleDrillDown(data.name, data.list)}
                            >
                                <Cell fill="#10b981" stroke="#fff" strokeWidth={2}/>
                                <Cell fill="#f59e0b" stroke="#fff" strokeWidth={2}/>
                                <Cell fill="#94a3b8" stroke="#fff" strokeWidth={2}/>
                            </Pie>
                            <RechartsTooltip formatter={(value, name) => [`${value} Accounts`, name]} />
                            <Legend verticalAlign="bottom" height={36} wrapperStyle={{paddingTop: 10}}/>
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
              <div onClick={() => handleDrillDown('No EV Suspected Users', metrics.noEv)} className="bg-white border border-slate-300 p-6 rounded-xl shadow-sm flex justify-between items-center cursor-pointer hover:bg-slate-100 transition">
                <div>
                  <h3 className="text-slate-700 font-bold">No EV Suspected</h3>
                  <p className="text-slate-600/70 text-sm">Not Confirmed or Suspected</p>
                </div>
                <div className="text-3xl font-bold text-slate-700">{metrics.noEv.length}</div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Battery Issues */}
        {activeTab === 'Battery Issues' && (
          <div className="space-y-6 flex-1 flex flex-col">
            
            {/* Top Stat Cards WITH PERCENTAGES */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-white p-4 rounded-xl border shadow-sm flex flex-col justify-center items-center text-center">
                <span className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Total Portfolio</span>
                <span className="text-2xl font-black text-slate-900">{metrics.totalBattery}</span>
                <span className="text-[10px] text-transparent mt-1 select-none">Spacer</span>
              </div>
              <div onClick={() => handleDrillDown('Batteries Setup', metrics.battSetup)} className="bg-white p-4 rounded-xl border border-indigo-200 shadow-sm flex flex-col justify-center items-center cursor-pointer hover:bg-indigo-50 text-center">
                <span className="text-indigo-600 text-xs font-bold uppercase tracking-wider mb-1">Setup</span>
                <span className="text-2xl font-black text-indigo-700">{metrics.battSetup.length}</span>
                <span className="text-[10px] font-semibold text-indigo-500 mt-1">{(metrics.battSetup.length / metrics.totalBattery * 100 || 0).toFixed(1)}% of total</span>
              </div>
              <div onClick={() => handleDrillDown('Batteries Online', metrics.battOnline)} className="bg-white p-4 rounded-xl border border-emerald-200 shadow-sm flex flex-col justify-center items-center cursor-pointer hover:bg-emerald-50 text-center">
                <span className="text-emerald-600 text-xs font-bold uppercase tracking-wider mb-1">Online</span>
                <span className="text-2xl font-black text-emerald-700">{metrics.battOnline.length}</span>
                <div className="text-[10px] font-semibold text-emerald-600 mt-1 leading-tight">
                    {(metrics.battOnline.length / metrics.battSetup.length * 100 || 0).toFixed(1)}% of setup<br/>
                    <span className="text-emerald-600/70">{(metrics.battOnline.length / metrics.totalBattery * 100 || 0).toFixed(1)}% of total</span>
                </div>
              </div>
              <div onClick={() => handleDrillDown('Batteries Offline', metrics.battOffline)} className="bg-white p-4 rounded-xl border border-red-200 shadow-sm flex flex-col justify-center items-center cursor-pointer hover:bg-red-50 text-center">
                <span className="text-red-600 text-xs font-bold uppercase tracking-wider mb-1">Offline</span>
                <span className="text-2xl font-black text-red-700">{metrics.battOffline.length}</span>
                <div className="text-[10px] font-semibold text-red-500 mt-1 leading-tight">
                    {(metrics.battOffline.length / metrics.battSetup.length * 100 || 0).toFixed(1)}% of setup<br/>
                    <span className="text-red-500/70">{(metrics.battOffline.length / metrics.totalBattery * 100 || 0).toFixed(1)}% of total</span>
                </div>
              </div>
              <div onClick={() => handleDrillDown('Batteries Not Setup', metrics.battNotSetup)} className="bg-white p-4 rounded-xl border border-slate-300 shadow-sm flex flex-col justify-center items-center cursor-pointer hover:bg-slate-100 text-center">
                <span className="text-slate-600 text-xs font-bold uppercase tracking-wider mb-1">Not Setup</span>
                <span className="text-2xl font-black text-slate-700">{metrics.battNotSetup.length}</span>
                <span className="text-[10px] font-semibold text-slate-500 mt-1">{(metrics.battNotSetup.length / metrics.totalBattery * 100 || 0).toFixed(1)}% of total</span>
              </div>
            </div>

            {/* GRAPHIC: Average Delays by Site */}
            <div className="bg-white p-6 rounded-xl border shadow-sm flex flex-col">
                <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2"><BarChart3 className="text-indigo-500"/> Average Battery Delays & Offline Time by Site</h3>
                <p className="text-sm text-slate-500 mb-6">Identifies sites requiring attention due to high average setup delays or offline durations (Top 25 offenders).</p>
                <div className="h-[400px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={metrics.siteDelayData} margin={{ top: 5, right: 30, left: 20, bottom: 80 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false}/>
                            <XAxis dataKey="name" angle={-45} textAnchor="end" tick={{fontSize: 11}} interval={0} />
                            <YAxis />
                            <RechartsTooltip cursor={{fill: '#f1f5f9'}} />
                            <Legend verticalAlign="top" wrapperStyle={{paddingBottom: '20px'}}/>
                            <Bar dataKey="avgSetupDelay" name="Avg Setup Delay (Days)" stackId="a" fill="#f59e0b" />
                            <Bar dataKey="avgOfflineDays" name="Avg Offline (Days)" stackId="a" fill="#ef4444" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
                {metrics.siteDelayData.length === 0 && <div className="text-center text-slate-500 pb-10">No setup delays or offline data found.</div>}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              
              <div className="bg-white p-6 rounded-xl border shadow-sm flex-1 flex flex-col">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="font-bold text-slate-800 flex items-center gap-2"><MapPin className="text-indigo-500"/> Site Progress</h3>
                      <div className="relative">
                          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"/>
                          <input type="text" placeholder="Search Site..." value={batterySiteSearch} onChange={e=>setBatterySiteSearch(e.target.value)} className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-md text-xs focus:ring-1 focus:ring-indigo-500 outline-none w-32" />
                      </div>
                  </div>
                  <div className="space-y-5 flex-1 max-h-96 overflow-y-auto pr-4">
                      {filteredBatterySites.map((site, i) => {
                          const onlinePct = (site.online / site.total) * 100 || 0;
                          return (
                              <div key={i} className="flex flex-col gap-1 flex-1">
                                  <div className="flex justify-between text-sm items-end flex-1">
                                      <span className="font-bold text-slate-700 truncate max-w-[50%] flex-1">{site.name}</span>
                                      <span className="text-slate-500 text-xs flex-1 text-right">
                                          <span className="text-emerald-600 font-medium">{onlinePct.toFixed(0)}% Online</span> 
                                          {' '}({site.total} homes)
                                      </span>
                                  </div>
                                  <div className="w-full h-5 flex rounded-md overflow-hidden bg-slate-100 cursor-pointer shadow-inner flex-1">
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
                      {filteredBatterySites.length === 0 && <div className="text-slate-500 text-sm text-center py-4">No sites match search.</div>}
                  </div>
              </div>

              {/* Problematic Accounts (Filterable & Sortable) */}
              <div className="lg:col-span-2 bg-white p-6 rounded-xl border shadow-sm overflow-hidden flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2"><BatteryWarning className="text-red-500"/> Problematic Accounts</h3>
                  <div className="relative">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"/>
                      <input type="text" placeholder="Search Account..." value={batteryProblemSearch} onChange={e=>setBatteryProblemSearch(e.target.value)} className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-1 focus:ring-indigo-500 outline-none w-48" />
                  </div>
                </div>
                <div className="overflow-auto border border-slate-100 rounded-lg max-h-96">
                  <table className="w-full text-xs text-left whitespace-nowrap select-none">
                    <thead className="bg-slate-50 text-slate-600 sticky top-0 shadow-sm flex-1">
                      <tr>
                        <th className="p-3 cursor-pointer hover:bg-slate-200" onClick={() => handleProblemSort('latest_account_number_for_address')}>Account <ProblemSortIcon colKey="latest_account_number_for_address"/></th>
                        <th className="p-3 cursor-pointer hover:bg-slate-200" onClick={() => handleProblemSort('account_type')}>Type <ProblemSortIcon colKey="account_type"/></th>
                        <th className="p-3 cursor-pointer hover:bg-slate-200" onClick={() => handleProblemSort('postal_number')}>Address <ProblemSortIcon colKey="postal_number"/></th>
                        <th className="p-3 cursor-pointer hover:bg-slate-200" onClick={() => handleProblemSort('site_name')}>Site <ProblemSortIcon colKey="site_name"/></th>
                        <th className="p-3 cursor-pointer hover:bg-slate-200" onClick={() => handleProblemSort('derived_status')}>Status <ProblemSortIcon colKey="derived_status"/></th>
                        <th className="p-3 cursor-pointer hover:bg-slate-200 text-red-600" onClick={() => handleProblemSort('derived_days_issue')} title="Days still without battery setup or days offline">Days Offline / w/o Setup <ProblemSortIcon colKey="derived_days_issue"/></th>
                        <th className="p-3 cursor-pointer hover:bg-slate-200 text-center" onClick={() => handleProblemSort('is_zero_readings')} title="Has been setup but never sent a reading">Setup but Readings Zero <ProblemSortIcon colKey="is_zero_readings"/></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 flex-1">
                      {sortedAndFilteredBatteryProblems.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="p-3 font-medium text-slate-900">{r.latest_account_number_for_address}</td>
                          <td className="p-3 capitalize">{r.account_type}</td>
                          <td className="p-3">{getAddress(r)}</td>
                          <td className="p-3">{r.site_name}</td>
                          <td className="p-3 font-semibold">
                            {r.derived_status === 'Not Setup' ? <span className="text-slate-500">Not Setup</span> : <span className="text-red-600">Offline</span>}
                          </td>
                          <td className="p-3 text-red-600 font-black">
                            {r.derived_days_issue || ''}
                          </td>
                          <td className="p-3 text-center text-lg">
                            {r.is_zero_readings === 1 ? '🚩' : ''}
                          </td>
                        </tr>
                      ))}
                      {sortedAndFilteredBatteryProblems.length === 0 && <tr><td colSpan="7" className="p-6 text-center text-slate-500">No accounts match your search.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border shadow-sm flex-1 flex flex-col">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-slate-800">Detailed Site Battery Tracker</h3>
                    <div className="flex items-center gap-4">
                        <div className="relative">
                          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"/>
                          <input type="text" placeholder="Search Site..." value={batterySiteSearch} onChange={e=>setBatterySiteSearch(e.target.value)} className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-1 focus:ring-indigo-500 outline-none w-48" />
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm"></span> Online</div>
                            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-red-500 rounded-sm"></span> Offline</div>
                            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-slate-300 rounded-sm"></span> Not Setup</div>
                        </div>
                    </div>
                </div>
                <div className="overflow-auto border border-slate-100 rounded-lg flex-1">
                    <table className="w-full text-sm text-left whitespace-nowrap">
                        <thead className="bg-slate-50 text-slate-600 sticky top-0 shadow-sm flex-1">
                            <tr>
                                <th className="p-3 font-semibold text-xs uppercase tracking-wider">Company</th>
                                <th className="p-3 font-semibold text-xs uppercase tracking-wider">Site (Tranche)</th>
                                <th className="p-3 font-semibold text-xs uppercase tracking-wider text-center">Committed</th>
                                <th className="p-3 font-semibold text-xs uppercase tracking-wider w-1/3">Status Breakdown</th>
                                <th className="p-3 font-semibold text-xs uppercase tracking-wider text-right">Progress</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 flex-1">
                            {filteredBatterySites.map((site, i) => {
                                const onlinePct = (site.online / site.total) * 100 || 0;
                                let progressBadgeColor = 'bg-red-100 text-red-800'; 
                                if (onlinePct === 100) progressBadgeColor = 'bg-emerald-100 text-emerald-800';
                                else if (onlinePct >= 70) progressBadgeColor = 'bg-orange-100 text-orange-800';
                                else if (onlinePct >= 30) progressBadgeColor = 'bg-amber-100 text-amber-800'; 

                                return (
                                    <tr key={i} className="hover:bg-slate-50 transition flex-1">
                                        <td className="p-3 font-medium text-slate-900">{site.company}</td>
                                        <td className="p-3">
                                            <div className="text-sm font-semibold text-slate-800">{site.name}</div>
                                            <div className="text-xs text-slate-500">{site.tranche}</div>
                                        </td>
                                        <td className="p-3 text-center text-lg font-black text-slate-700">{site.total}</td>
                                        <td className="p-3">
                                            <div className="w-full h-6 flex rounded overflow-hidden bg-slate-100 cursor-pointer shadow-inner relative">
                                                <div 
                                                    className="bg-emerald-500 hover:opacity-85 transition" 
                                                    style={{width: `${(site.online/site.total)*100}%`}} 
                                                    title={`${site.online} Online`}
                                                    onClick={() => handleDrillDown(`${site.name} - Online`, site.onlineData)}
                                                ></div>
                                                <div 
                                                    className="bg-red-500 hover:opacity-85 transition" 
                                                    style={{width: `${(site.offline/site.total)*100}%`}} 
                                                    title={`${site.offline} Offline`}
                                                    onClick={() => handleDrillDown(`${site.name} - Offline`, site.offlineData)}
                                                ></div>
                                                <div 
                                                    className="bg-slate-300 hover:opacity-85 transition" 
                                                    style={{width: `${(site.notSetup/site.total)*100}%`}} 
                                                    title={`${site.notSetup} Not Setup`}
                                                    onClick={() => handleDrillDown(`${site.name} - Not Setup`, site.notSetupData)}
                                                ></div>
                                            </div>
                                        </td>
                                        <td className="p-3 text-right">
                                            <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold ${progressBadgeColor}`}>
                                                {onlinePct.toFixed(1)}%
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Bottom Section: Past Battery Setup Delays */}
            <div className="bg-white border rounded-xl shadow-sm p-6 flex flex-col">
                <div className="mb-4">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Clock className="text-amber-500"/> Past Battery Setup Delay</h2>
                    <p className="text-sm text-slate-500 mt-1">Accounts with historical delays in getting the battery online.</p>
                </div>
                <div className="overflow-auto border border-slate-100 rounded-lg max-h-80">
                    <table className="w-full text-sm text-left whitespace-nowrap">
                        <thead className="bg-slate-50 text-slate-600 sticky top-0 shadow-sm">
                            <tr>
                                <th className="p-3 font-semibold">Account</th>
                                <th className="p-3 font-semibold">Type</th>
                                <th className="p-3 font-semibold">Address</th>
                                <th className="p-3 font-semibold">Site</th>
                                <th className="p-3 font-semibold text-amber-600">Past Setup Delay (Days)</th>
                                <th className="p-3 font-semibold">% Delay Time</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {metrics.pastBatteryDelays.map((r, i) => (
                                <tr key={i} className="hover:bg-slate-50">
                                    <td className="p-3 font-medium text-slate-900">{r.latest_account_number_for_address}</td>
                                    <td className="p-3 capitalize">{r.account_type}</td>
                                    <td className="p-3">{getAddress(r)}</td>
                                    <td className="p-3">{r.site_name}</td>
                                    <td className="p-3 font-bold text-amber-600">{r.days_without_battery_setup_past}</td>
                                    <td className="p-3">{r.without_battery_setup_percentage ? `${parseFloat(r.without_battery_setup_percentage).toFixed(1)}%` : ''}</td>
                                </tr>
                            ))}
                            {metrics.pastBatteryDelays.length === 0 && <tr><td colSpan="6" className="p-6 text-center text-slate-500">No historical delays found.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>

          </div>
        )}

        {/* Tab 5: Missing MPANs */}
        {activeTab === 'Missing MPANs' && (
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden flex flex-col flex-1">
            <div className="p-6 border-b flex flex-col md:flex-row md:justify-between md:items-center gap-4 bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">Missing Export MPANs & Issues</h2>
              
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"/>
                  <input type="text" placeholder="Search Account..." value={missingMpanSearch} onChange={e=>setMissingMpanSearch(e.target.value)} className="pl-8 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
                <select 
                  value={mpanTypeFilter} 
                  onChange={e => setMpanTypeFilter(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="All">All Types</option>
                  <option value="Developer">Developer Only</option>
                  <option value="Customer">Customer Only</option>
                </select>
                <button onClick={() => handleDrillDown('All Missing MPANs', filteredMissingMpans)} className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 transition flex items-center gap-1.5">View Extracted List</button>
              </div>
            </div>
            
            <div className="overflow-auto p-4 flex-1">
              <table className="w-full text-sm text-left flex-1 whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-600 sticky top-0 shadow-sm flex-1">
                  <tr>
                    <th className="p-3">Account / MPAN</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Address</th>
                    <th className="p-3">Postcode</th>
                    <th className="p-3">Site</th>
                    <th className="p-3">Import Energisation</th>
                    <th className="p-3">Export Energisation</th>
                    <th className="p-3 bg-red-50">Detected Issues</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 flex-1">
                  {filteredMissingMpans.map((r, i) => {
                      const impDen = String(r.import_energisation_status).toLowerCase() === 'denergised';
                      const expDen = String(r.export_energisation_status).toLowerCase() === 'denergised';
                      return (
                        <tr key={i} className="hover:bg-slate-50 flex-1">
                          <td className="p-3 font-medium text-slate-900">{r.latest_account_number_for_address || r.import_mpans}</td>
                          <td className="p-3 capitalize">{r.account_type}</td>
                          <td className="p-3">{getAddress(r)}</td>
                          <td className="p-3 font-medium text-slate-700">{r.postcode}</td>
                          <td className="p-3 font-semibold text-indigo-700">{r.site_name}</td>
                          <td className={`p-3 ${impDen ? 'text-red-600 font-bold' : ''}`}>{r.import_energisation_status}</td>
                          <td className={`p-3 ${expDen ? 'text-red-600 font-bold' : ''}`}>{r.export_energisation_status}</td>
                          <td className="p-3 text-xs font-semibold text-red-600 bg-red-50/30">
                            <div>Missing Export MPAN</div>
                            {(impDen || expDen) && <div>Denergised Status detected</div>}
                          </td>
                        </tr>
                      );
                  })}
                  {filteredMissingMpans.length === 0 && <tr><td colSpan="8" className="p-6 text-center text-slate-500">No matching accounts found.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 6: Missing Smart Reads */}
        {activeTab === 'Missing Smart Reads' && (
          <div className="bg-white border rounded-xl shadow-sm p-6 flex-1 flex flex-col">
             <div className="mb-6 flex flex-col md:flex-row justify-between md:items-center gap-4 border-b pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Accounts with Missing Smart Reads</h2>
                <p className="text-sm text-slate-500 mt-1">Checking both import and export dates. Flagged if last read is over 3 days old. (Safely ignores missing MPANs).</p>
              </div>
              <div className="relative w-full md:w-64">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"/>
                <input type="text" placeholder="Search Account..." value={missingSmartReadsSearch} onChange={e=>setMissingSmartReadsSearch(e.target.value)} className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
            </div>

            {filteredMissingSmartReads.length === 0 && !missingSmartReadsSearch ? (
              <div className="flex flex-col items-center justify-center py-20 text-emerald-600 bg-emerald-50 rounded-xl border border-emerald-100 flex-1">
                <Smile size={80} className="mb-6 text-emerald-500"/>
                <h2 className="text-3xl font-black">All smart meters online!</h2>
                <p className="text-emerald-700/80 mt-2 font-medium">No smart read data is missing or stale.</p>
              </div>
            ) : (
              <div className="overflow-auto border border-slate-100 rounded-lg flex-1">
                <table className="w-full text-sm text-left flex-1 whitespace-nowrap">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0 shadow-sm flex-1">
                    <tr>
                      <th className="p-3">Account</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">Address</th>
                      <th className="p-3">Postcode</th>
                      <th className="p-3">Site</th>
                      <th className="p-3 text-center">Import Last Read</th>
                      <th className="p-3 text-center">Export Last Read</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 flex-1">
                    {filteredMissingSmartReads.map((r, i) => {
                      // Verify MPANs exist before evaluating dates
                      const hasImport = hasValidMpan(r.import_mpans, r.import_mpan);
                      const hasExport = hasValidMpan(r.export_mpans, r.export_mpan);

                      const impStale = hasImport && isDateStale(r.import_last_smart_read_date);
                      const expStale = hasExport && isDateStale(r.export_last_smart_read_date);
                      
                      return (
                        <tr key={i} className="hover:bg-slate-50 flex-1">
                          <td className="p-3 font-medium text-slate-900">{r.latest_account_number_for_address || r.import_mpans}</td>
                          <td className="p-3 capitalize">{r.account_type}</td>
                          <td className="p-3">{getAddress(r)}</td>
                          <td className="p-3">{r.postcode}</td>
                          <td className="p-3 font-medium text-indigo-700">{r.site_name}</td>
                          
                          {/* Clean display handling */}
                          <td className={`p-3 text-center font-semibold ${impStale ? 'text-red-600' : (!hasImport ? 'text-slate-400 italic' : '')}`}>
                            {hasImport ? (r.import_last_smart_read_date || 'Missing') : 'No MPAN'}
                          </td>
                          <td className={`p-3 text-center font-semibold ${expStale ? 'text-red-600' : (!hasExport ? 'text-slate-400 italic' : '')}`}>
                            {hasExport ? (r.export_last_smart_read_date || 'Missing') : 'No MPAN'}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredMissingSmartReads.length === 0 && <tr><td colSpan="7" className="p-6 text-center text-slate-500">No matching accounts found.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 7: EOY Projection */}
        {activeTab === 'EOY Projection' && (
          <div className="flex flex-col gap-6">
            
            {/* NEW GRAPHIC: Average EOY Projected Position per Site */}
            <div className="bg-white p-6 rounded-xl border shadow-sm flex flex-col">
                <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2"><BarChart3 className="text-indigo-500"/> Average EOY Projected Net Position by Site</h3>
                <p className="text-sm text-slate-500 mb-6">Click on any bar to see the individual accounts, their projected EOY vs current Net Import, and days on tariff.</p>
                <div className="h-[400px] w-full cursor-pointer">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={metrics.eoySiteSummary} margin={{ top: 5, right: 30, left: 20, bottom: 80 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false}/>
                            <XAxis dataKey="name" angle={-45} textAnchor="end" tick={{fontSize: 11}} interval={0} />
                            <YAxis />
                            <RechartsTooltip cursor={{fill: '#f1f5f9'}} formatter={(value) => [`${value} kWh`, 'Average EOY']} />
                            <Bar 
                                dataKey="avgEoy" 
                                name="Average EOY Net Import" 
                                fill="#8b5cf6" 
                                onClick={(data) => handleDrillDown(`EOY Average Breakdown: ${data.name}`, data.accounts)}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Bottom Section: Individual EOY Projections */}
            <div className="bg-white border rounded-xl shadow-sm p-6 flex flex-col h-[700px]">
              <div className="mb-6 border-b pb-4 flex flex-col md:flex-row justify-between md:items-end gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Individual EOY Projected Net Import vs Allowance</h2>
                  <p className="text-sm text-slate-500 mt-1">Horizontal bar chart showing individual EOY Projections. The dotted line marks the current net import position.</p>
                  <div className="flex gap-4 mt-4 text-xs font-medium">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{backgroundColor: '#ef4444'}}></span> Over 4000</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{backgroundColor: '#ea580c'}}></span> 3000 - 4000</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{backgroundColor: '#facc15'}}></span> 2000 - 3000</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{backgroundColor: '#10b981'}}></span> Under 2000</span>
                  </div>
                </div>
                <div className="bg-indigo-50 border-2 border-indigo-100 px-6 py-5 rounded-xl text-center shadow-inner">
                  <div className="text-xs text-indigo-600 font-black uppercase tracking-widest mb-1.5">Portfolio Average EOY</div>
                  <div className="text-3xl font-black text-indigo-700">{metrics.avgEoy.toFixed(0)} <span className="text-xl text-slate-500 font-normal">kWh</span></div>
                </div>
              </div>

              {/* Controls: Search and Sort */}
              <div className="flex flex-col md:flex-row gap-4 mb-6">
                  <div className="relative flex-1 max-w-md">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                      <input 
                          type="text" 
                          placeholder="Search by Account Number or MPAN..." 
                          value={eoySearchQuery} 
                          onChange={e => setEoySearchQuery(e.target.value)}
                          className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                  </div>
                  <select 
                      value={eoySortBy} 
                      onChange={e => setEoySortBy(e.target.value)}
                      className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                      <option value="usage_desc">Highest to Lowest EOY Usage</option>
                      <option value="usage_asc">Lowest to Highest EOY Usage</option>
                      <option value="days_desc">Highest to Lowest Days in Contract</option>
                      <option value="days_asc">Lowest to Highest Days in Contract</option>
                  </select>
              </div>

              <div className="space-y-8 overflow-y-auto pr-4 flex-1 pb-10">
                {processedEoyData.map((row, i) => {
                    const eoy = parseCleanNumber(row.eoy_projected_net_import);
                    
                    const currentNet = parseCleanNumber(row.net_import_contract) || parseCleanNumber(row.net_import_contract_ev_adjusted) || 0;
                    
                    let barColor = '#10b981'; // emerald-500
                    if (eoy > 4000) barColor = '#ef4444'; // red-500
                    else if (eoy >= 3000) barColor = '#ea580c'; // dark orange (orange-600)
                    else if (eoy >= 2000) barColor = '#facc15'; // yellow-400

                    const MAX_SCALE = Math.max(4500, eoy + 1000); 
                    const eoyWidthPct = Math.max(0, Math.min((eoy / MAX_SCALE) * 100, 100)); 
                    const currentWidthPct = Math.max(0, Math.min((currentNet / MAX_SCALE) * 100, 100)); 

                    return (
                      <div key={i} className="flex flex-col gap-1 w-full relative pt-2">
                        <div className="flex justify-between items-end gap-2 mb-1">
                          <div className="font-bold text-slate-800 text-sm">
                              {row.latest_account_number_for_address || row.import_mpans || 'Unknown Account'}
                              <span className="text-xs text-slate-500 font-normal ml-2">({row.days_this_contract} days into contract)</span>
                              {eoy < 0 && <span className="ml-3 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">Net Exporter</span>}
                          </div>
                        </div>
                        
                        <div className="w-full min-h-[32px] shrink-0 bg-slate-100 rounded-md border border-slate-200 relative shadow-inner">
                          
                          <div 
                            className="h-full absolute top-0 left-0 transition-all rounded-l-md" 
                            style={{ width: `${eoyWidthPct}%`, backgroundColor: barColor }}
                          ></div>
                          
                          <div 
                            className="absolute top-0 bottom-0 flex items-center pl-2 whitespace-nowrap font-black text-slate-800 drop-shadow-sm text-sm" 
                            style={{ left: `${eoyWidthPct}%` }}
                          >
                             {eoy.toFixed(0)} kWh
                          </div>

                          <div 
                            className="absolute top-0 bottom-0 border-l-[3px] border-slate-800 border-dotted z-10" 
                            style={{left: `${currentWidthPct}%`}} 
                            title={`Current Net Import: ${currentNet.toFixed(0)} kWh`}
                          >
                             <div className="absolute top-full mt-1 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold text-slate-700 bg-slate-50 px-1.5 py-0.5 rounded shadow-sm border border-slate-200">
                                 Current: {currentNet.toFixed(0)}
                             </div>
                          </div>
                          
                          <div 
                            className="absolute top-0 bottom-0 border-l-2 border-red-600 border-dashed opacity-50 pointer-events-none" 
                            style={{left: `${(4000/MAX_SCALE)*100}%`}} 
                          ></div>

                        </div>
                      </div>
                    );
                })}
                {processedEoyData.length === 0 && (
                   <div className="text-center text-slate-500 py-10">No accounts match your search.</div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>

      <DrillDownModal />
    </div>
  );
}
