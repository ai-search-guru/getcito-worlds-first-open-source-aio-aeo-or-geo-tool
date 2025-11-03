import { useAuthContext } from '@/context/AuthContext';
import { updateUserCredits, deductCredits, addCredits } from '@/firebase/firestore/userProfile';

export function useUserCredits() {
  const { user, userProfile, refreshUserProfile } = useAuthContext();

  const updateCredits = async (amount: number): Promise<{ success: boolean; error?: any }> => {
    if (!user) {
      return { success: false, error: 'User not authenticated' };
    }

    const { result, error } = await updateUserCredits(user.uid, amount);
    
    if (result) {
      // Refresh user profile to get updated credits
      await refreshUserProfile();
      return { success: true };
    }
    
    return { success: false, error };
  };

  const deduct = async (amount: number): Promise<{ success: boolean; error?: any }> => {
    if (!user) {
      return { success: false, error: 'User not authenticated' };
    }

    if (!userProfile || userProfile.credits < amount) {
      return { success: false, error: 'Insufficient credits' };
    }

    const { result, error } = await deductCredits(user.uid, amount);
    
    if (result) {
      await refreshUserProfile();
      return { success: true };
    }
    
    return { success: false, error };
  };

  const add = async (amount: number): Promise<{ success: boolean; error?: any }> => {
    if (!user) {
      return { success: false, error: 'User not authenticated' };
    }

    const { result, error } = await addCredits(user.uid, amount);
    
    if (result) {
      await refreshUserProfile();
      return { success: true };
    }
    
    return { success: false, error };
  };

  const hasCredits = (amount: number): boolean => {
    return userProfile ? userProfile.credits >= amount : false;
  };

  return {
    credits: userProfile?.credits || 0,
    updateCredits,
    deduct,
    add,
    hasCredits,
    loading: !userProfile && !!user
  };
} 