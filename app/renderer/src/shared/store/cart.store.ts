import { create } from 'zustand';
import type { PaymentMethod, PaymentInput } from '../types/sales.types';
import type { Product } from '../types/inventory.types';

export interface CartItem {
  product: Product;
  quantity: number;
  unitPrice: number;
  discount: number;
}

export interface Customer {
  id: number;
  name: string;
  fullName?: string;
  phone: string | null;
  email?: string | null;
}

type DiscountType = 'percentage' | 'fixed';
type PaymentStep = 'options' | 'cash' | 'mixed-step-1' | 'mixed-step-2';

interface CartState {
  cart: CartItem[];
  selectedCustomerId: number | null;
  selectedCustomer: Customer | null;
  deliveryFee: number;
  globalDiscount: number;
  discountType: DiscountType;
  payments: PaymentInput[];
  cashReceived: number;
  selectedMethod: PaymentMethod | null;
  showCheckoutModal: boolean;
  paymentStep: PaymentStep;
  mixtoCashAmount: number;

  addToCart: (product: Product, price?: number) => void;
  updateCartQty: (productId: number, quantity: number) => void;
  removeFromCart: (productId: number) => void;
  clearCart: () => void;
  setDeliveryFee: (fee: number) => void;
  setGlobalDiscount: (discount: number) => void;
  setDiscountType: (type: DiscountType) => void;
  setSelectedCustomer: (customer: Customer | null) => void;
  addPayment: (payment: PaymentInput) => void;
  removePayment: (index: number) => void;
  clearPayments: () => void;
  setCashReceived: (amount: number) => void;
  setSelectedMethod: (method: PaymentMethod | null) => void;
  setShowCheckoutModal: (show: boolean) => void;
  setPaymentStep: (step: PaymentStep) => void;
  setMixtoCashAmount: (amount: number) => void;
}

export const useCartStore = create<CartState>((set) => ({
  cart: [],
  selectedCustomerId: null,
  selectedCustomer: null,
  deliveryFee: 0,
  globalDiscount: 0,
  discountType: 'percentage',
  payments: [],
  cashReceived: 0,
  selectedMethod: null,
  showCheckoutModal: false,
  paymentStep: 'options',
  mixtoCashAmount: 0,

  addToCart: (product, price) =>
    set((state) => {
      const existing = state.cart.find((item) => item.product.id === product.id);
      if (existing) {
        return {
          cart: state.cart.map((item) =>
            item.product.id === product.id
              ? { ...item, quantity: item.quantity + 1 }
              : item,
          ),
        };
      }
      return {
        cart: [
          ...state.cart,
          {
            product,
            quantity: 1,
            unitPrice: price ?? product.price,
            discount: 0,
          },
        ],
      };
    }),

  updateCartQty: (productId, quantity) =>
    set((state) => ({
      cart: state.cart
        .map((item) =>
          item.product.id === productId
            ? { ...item, quantity: Math.max(1, quantity) }
            : item,
        ),
    })),

  removeFromCart: (productId) =>
    set((state) => ({
      cart: state.cart.filter((item) => item.product.id !== productId),
    })),

  clearCart: () =>
    set({
      cart: [],
      selectedCustomerId: null,
      selectedCustomer: null,
      deliveryFee: 0,
      globalDiscount: 0,
      discountType: 'percentage',
      payments: [],
      cashReceived: 0,
      selectedMethod: null,
      showCheckoutModal: false,
      paymentStep: 'options',
      mixtoCashAmount: 0,
    }),

  setDeliveryFee: (fee) => set({ deliveryFee: fee }),
  setGlobalDiscount: (discount) => set({ globalDiscount: discount }),
  setDiscountType: (type) => set({ discountType: type }),

  setSelectedCustomer: (customer) =>
    set({
      selectedCustomer: customer,
      selectedCustomerId: customer?.id ?? null,
    }),

  addPayment: (payment) =>
    set((state) => ({
      payments: [...state.payments, payment],
    })),

  removePayment: (index) =>
    set((state) => ({
      payments: state.payments.filter((_, i) => i !== index),
    })),

  clearPayments: () => set({ payments: [] }),

  setCashReceived: (amount) => set({ cashReceived: amount }),
  setSelectedMethod: (method) => set({ selectedMethod: method }),
  setShowCheckoutModal: (show) => set({ showCheckoutModal: show }),
  setPaymentStep: (step) => set({ paymentStep: step }),
  setMixtoCashAmount: (amount) => set({ mixtoCashAmount: amount }),
}));
