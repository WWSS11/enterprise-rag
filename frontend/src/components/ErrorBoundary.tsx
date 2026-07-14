import { Component, type ErrorInfo, type ReactNode } from "react";
import i18n from "@/i18n";
import { Button } from "./Button";
import { TechnicalDetails } from "./TechnicalDetails";
import styles from "./ErrorBoundary.module.css";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Never log tokens. Stack/component stack only.
    console.error("Unhandled UI error", error.message, info.componentStack);
  }

  private handleReload = () => {
    window.location.assign("/");
  };

  private handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className={styles.page}>
          <section className={styles.panel} role="alert" aria-labelledby="error-boundary-title">
            <h1 id="error-boundary-title" className={styles.title}>
              {i18n.t("errors:boundaryTitle")}
            </h1>
            <p className={styles.detail}>{i18n.t("errors:boundaryBody")}</p>
            <TechnicalDetails detail={this.state.error.message} />
            <div className={styles.actions}>
              <Button type="button" onClick={this.handleReload}>
                {i18n.t("errors:reloadApp")}
              </Button>
              <Button type="button" variant="secondary" onClick={this.handleReset}>
                {i18n.t("errors:tryContinue")}
              </Button>
            </div>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}
