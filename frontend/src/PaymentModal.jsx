import { useState } from 'react';

export default function PaymentModal({ isOpen, onClose, auction, winningBid }) {
  const [paymentMethod, setPaymentMethod] = useState('upi');
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  const handlePayment = async (e) => {
    e.preventDefault();
    setIsProcessing(true);
    
    // Simulate payment processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    setIsProcessing(false);
    onClose();
    // Here you would typically redirect to a success page or show a success message
  };

  const formatAmount = (amount) => {
    return Number(amount).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD'
    });
  };

  return (
    <div className="payment-modal-overlay" onClick={onClose}>
      <div className="payment-modal" onClick={e => e.stopPropagation()}>
        <div className="payment-modal-header">
          <div className="payment-modal-header-icon">💳</div>
          <div className="payment-modal-header-content">
            <h2>Payment Required</h2>
            <p>Auction Closed - Secure Checkout</p>
          </div>
        </div>
        
        <div className="payment-modal-body">
          <div className="payment-amount-section">
            <div className="payment-amount-label">Total Amount to Pay</div>
            <div className="payment-amount-value">
              {formatAmount(winningBid || auction?.current_high_price || 0)}
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
              {auction?.title || auction?.name || `Auction #${auction?.id}`}
            </div>
          </div>

          <div className="payment-method-section">
            <div className="payment-method-label">Select Payment Method</div>
            <div className="payment-method-options">
              <label className={`payment-method-option ${paymentMethod === 'upi' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="paymentMethod"
                  value="upi"
                  checked={paymentMethod === 'upi'}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                />
                <span className="payment-method-option-label">UPI Payment</span>
              </label>
              
              <label className={`payment-method-option ${paymentMethod === 'card' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="paymentMethod"
                  value="card"
                  checked={paymentMethod === 'card'}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                />
                <span className="payment-method-option-label">Credit/Debit Card</span>
              </label>
              
              <label className={`payment-method-option ${paymentMethod === 'bank' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="paymentMethod"
                  value="bank"
                  checked={paymentMethod === 'bank'}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                />
                <span className="payment-method-option-label">Bank Transfer</span>
              </label>
            </div>
          </div>
        </div>

        <div className="payment-modal-footer">
          <button 
            className="payment-modal-close" 
            onClick={onClose}
            disabled={isProcessing}
          >
            Cancel
          </button>
          <button 
            className="payment-modal-submit" 
            onClick={handlePayment}
            disabled={isProcessing}
          >
            {isProcessing ? 'Processing...' : 'Pay Securely'}
          </button>
        </div>
      </div>
    </div>
  );
}