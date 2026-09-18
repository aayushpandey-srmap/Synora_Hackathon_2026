import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAllAssets, getAuthToken } from './api.js';

function Logo() {
  return <div className="brand-mark" aria-hidden="true"><span /><span /></div>;
}

function Sparkline() {
  return (
    <svg className="sparkline" viewBox="0 0 560 112" preserveAspectRatio="none" role="img" aria-label="Incoming bid velocity sparkline">
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#dce6db" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#dce6db" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="spark-area" d="M0 93 L40 96 L78 85 L120 89 L151 70 L192 84 L225 63 L273 78 L313 57 L348 75 L386 52 L423 65 L459 43 L506 60 L560 22 L560 112 L0 112 Z" />
      <polyline className="spark-line" points="0,93 40,96 78,85 120,89 151,70 192,84 225,63 273,78 313,57 348,75 386,52 423,65 459,43 506,60 560,22" />
      <circle className="spark-dot" cx="560" cy="22" r="3" />
    </svg>
  );
}

function AssetCard({ asset }) {
  const currentBid = asset.current_high_price || asset.starting_price || 0;
  const startingPrice = asset.starting_price || 0;
  const gain = startingPrice > 0 ? ((currentBid - startingPrice) / startingPrice * 100).toFixed(2) : 0;

  return (
    <Link to={`/assets/${asset.id}`} className="asset-card">
      <div className="asset-card-image">
        <div className="asset-thumbnail">
          <Logo />
        </div>
        <div className="asset-badge">
          <span className="status-dot" />
          ACTIVE
        </div>
      </div>
      <div className="asset-card-content">
        <h3 className="asset-card-title">{asset.title || asset.name || `Asset #${asset.id}`}</h3>
        <p className="asset-card-description">{asset.description || asset.asset_type || 'Institutional auction asset'}</p>
        <div className="asset-card-metrics">
          <div className="metric">
            <span className="metric-label">Starting Price</span>
            <span className="metric-value">${Number(startingPrice).toLocaleString('en-US')}</span>
          </div>
          <div className="metric">
            <span className="metric-label">Current Bid</span>
            <span className="metric-value">${Number(currentBid).toLocaleString('en-US')}</span>
            {gain > 0 && <span className="metric-gain">+{gain}%</span>}
          </div>
        </div>
        <div className="asset-card-footer">
          <span className="asset-id">LOT #{asset.id}</span>
          <span className="bid-count">{asset.bid_count || 0} bids</span>
        </div>
      </div>
    </Link>
  );
}

export default function AssetList() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const token = getAuthToken();

  useEffect(() => {
    const loadAssets = async () => {
      try {
        setLoading(true);
        // Mock data for now since we don't have a real backend
        const mockAssets = [
          {
            id: '108',
            title: 'Series-A Perpetual Treasury Bond',
            description: 'Liquidity Tranche - High-yield institutional asset',
            starting_price: 4290000,
            current_high_price: 4296500,
            bid_count: 35558,
            asset_type: 'TOKENIZED DEBT'
          },
          {
            id: '109',
            title: 'Tier-1 Spectrum License',
            description: 'Lot #409 - Federal auction allocation',
            starting_price: 42855000,
            current_high_price: 42885000,
            bid_count: 12453,
            asset_type: 'SPECTRUM LICENSE'
          },
          {
            id: '110',
            title: 'Corporate Bond Index Fund',
            description: 'Investment Grade - Q4 Allocation',
            starting_price: 15000000,
            current_high_price: 15250000,
            bid_count: 8934,
            asset_type: 'BOND FUND'
          },
          {
            id: '111',
            title: 'Renewable Energy Credits',
            description: 'Carbon Offset Portfolio - 2024 Vintage',
            starting_price: 2500000,
            current_high_price: 2680000,
            bid_count: 5621,
            asset_type: 'RECS'
          },
          {
            id: '112',
            title: 'Municipal Infrastructure Bond',
            description: 'Transportation Sector - 10-year Term',
            starting_price: 8000000,
            current_high_price: 8150000,
            bid_count: 7832,
            asset_type: 'MUNICIPAL BOND'
          },
          {
            id: '113',
            title: 'Technology Sector ETF',
            description: 'Growth Allocation - Semiconductor Focus',
            starting_price: 12000000,
            current_high_price: 12350000,
            bid_count: 15678,
            asset_type: 'ETF'
          }
        ];
        
        // Try to fetch from API first, fall back to mock data
        try {
          const fetchedAssets = await getAllAssets(token);
          if (fetchedAssets.length > 0) {
            setAssets(fetchedAssets);
          } else {
            setAssets(mockAssets);
          }
        } catch {
          setAssets(mockAssets);
        }
      } catch (err) {
        setError('Failed to load assets');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadAssets();
  }, [token]);

  if (loading) {
    return (
      <div className="asset-list-page">
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Loading auction assets...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="asset-list-page">
        <div className="error-state">
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="asset-list-page">
      <div className="page-header">
        <div className="page-title">
          <h1>Active Auctions</h1>
          <p>Browse and participate in live institutional auctions</p>
        </div>
        <div className="page-stats">
          <div className="stat">
            <span className="stat-label">Active Assets</span>
            <span className="stat-value">{assets.length}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Total Volume</span>
            <span className="stat-value">${assets.reduce((sum, a) => sum + (a.current_high_price || 0), 0).toLocaleString('en-US')}</span>
          </div>
        </div>
      </div>

      <div className="asset-grid">
        {assets.map(asset => (
          <AssetCard key={asset.id} asset={asset} />
        ))}
      </div>

      {assets.length === 0 && (
        <div className="empty-state">
          <Logo />
          <h3>No Active Auctions</h3>
          <p>Check back later for new auction opportunities</p>
        </div>
      )}
    </div>
  );
}