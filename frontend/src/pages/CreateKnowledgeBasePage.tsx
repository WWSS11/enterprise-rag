import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/Button";
import { OperationError } from "@/components/OperationError";
import styles from "./KnowledgeBaseOps.module.css";

const createFormSchema = z.object({
  slug: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().trim().min(1).max(255),
  description: z.string().max(4000),
  access_mode: z.enum(["tenant", "restricted"]),
});

type CreateFormValues = z.infer<typeof createFormSchema>;

export function CreateKnowledgeBasePage() {
  const { t } = useTranslation(["knowledgeBases", "common"]);
  const { api } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateFormValues>({
    resolver: zodResolver(createFormSchema),
    defaultValues: {
      slug: "",
      name: "",
      description: "",
      access_mode: "restricted",
    },
  });

  const createKnowledgeBase = useMutation({
    mutationFn: (values: CreateFormValues) =>
      api.createKnowledgeBase({
        slug: values.slug,
        name: values.name.trim(),
        description: values.description.trim() || null,
        access_mode: values.access_mode,
      }),
    onSuccess: async (knowledgeBase) => {
      await queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      navigate(`/app/knowledge-bases/${knowledgeBase.id}`, {
        replace: true,
        state: { created: true },
      });
    },
  });

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.kicker}>{t("knowledgeBases:kicker")}</div>
          <h1>{t("knowledgeBases:createTitle")}</h1>
          <p>{t("knowledgeBases:createSubtitle")}</p>
        </div>
        <Link className={styles.secondaryLink} to="/app/knowledge-bases">
          {t("knowledgeBases:backToList")}
        </Link>
      </header>

      {createKnowledgeBase.isError ? (
        <OperationError
          error={createKnowledgeBase.error}
          onRetry={
            createKnowledgeBase.variables
              ? () => createKnowledgeBase.mutate(createKnowledgeBase.variables)
              : undefined
          }
        />
      ) : null}

      <form className={styles.form} onSubmit={handleSubmit((values) => createKnowledgeBase.mutate(values))}>
        <div className={styles.formField}>
          <label htmlFor="kb-slug">{t("knowledgeBases:fieldSlug")}</label>
          <input
            id="kb-slug"
            autoComplete="off"
            maxLength={128}
            aria-invalid={Boolean(errors.slug)}
            aria-describedby="kb-slug-hint"
            {...register("slug")}
          />
          <p id="kb-slug-hint" className={styles.fieldHint}>
            {t("knowledgeBases:fieldSlugHint")}
          </p>
          {errors.slug ? (
            <p className={styles.validation} role="alert">
              {t("knowledgeBases:validationSlug")}
            </p>
          ) : null}
        </div>

        <div className={styles.formField}>
          <label htmlFor="kb-name">{t("knowledgeBases:fieldName")}</label>
          <input
            id="kb-name"
            maxLength={255}
            aria-invalid={Boolean(errors.name)}
            {...register("name")}
          />
          {errors.name ? (
            <p className={styles.validation} role="alert">
              {t("knowledgeBases:validationName")}
            </p>
          ) : null}
        </div>

        <div className={styles.formField}>
          <label htmlFor="kb-description">{t("knowledgeBases:fieldDescription")}</label>
          <textarea
            id="kb-description"
            rows={5}
            maxLength={4000}
            aria-invalid={Boolean(errors.description)}
            {...register("description")}
          />
          {errors.description ? (
            <p className={styles.validation} role="alert">
              {t("knowledgeBases:validationDescription")}
            </p>
          ) : null}
        </div>

        <fieldset className={styles.fieldset}>
          <legend>{t("knowledgeBases:fieldAccessMode")}</legend>
          <label className={styles.radioOption}>
            <input type="radio" value="restricted" {...register("access_mode")} />
            <span>
              <strong>{t("knowledgeBases:restrictedAccess")}</strong>
              <small>{t("knowledgeBases:accessRestrictedDetail")}</small>
            </span>
          </label>
          <label className={styles.radioOption}>
            <input type="radio" value="tenant" {...register("access_mode")} />
            <span>
              <strong>{t("knowledgeBases:tenantAccess")}</strong>
              <small>{t("knowledgeBases:accessTenantDetail")}</small>
            </span>
          </label>
        </fieldset>

        <div className={styles.formActions}>
          <Button type="submit" disabled={createKnowledgeBase.isPending}>
            {createKnowledgeBase.isPending
              ? t("knowledgeBases:creating")
              : t("knowledgeBases:createSubmit")}
          </Button>
          <Link className={styles.secondaryLink} to="/app/knowledge-bases">
            {t("common:cancel")}
          </Link>
        </div>
      </form>
    </div>
  );
}
