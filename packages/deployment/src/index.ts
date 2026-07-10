/**
 * @workspace/deployment - Deployment facade package
 *
 * Thin switch that picks the active deployment mode based on DEPLOYMENT_MODE
 * and delegates to the appropriate package (@workspace/local, @workspace/whitelabel).
 */

export { getDeployment, resetDeploymentCache, type GetDeploymentOptions } from "./deployment";

export { getOptimizeButtonForMode, type OptimizeButtonProps } from "./client";
