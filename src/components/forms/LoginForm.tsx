import { useEffect } from 'react';
import { FormProps } from '@/hooks/ui/useDialog';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../ui/form';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { useAuth } from '@/hooks/useAuth';
import { Link } from 'react-router-dom';

const formSchema = z.object({
  email: z.string(),
  password: z.string(),
});

const LoginForm = ({ formRef, setCanSubmit, closeDialog }: FormProps) => {
  const { t } = useTranslation();
  const { login, loginWithProvider, loading, error, setError } = useAuth();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
  });

  useEffect(() => {
    setCanSubmit(form.formState.isDirty && form.formState.isValid);
  }, [form.formState, setCanSubmit]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const { error: loginError } = await login(values.email, values.password);
    if (!loginError) {
      closeDialog?.();
    }
  };

  const handleOAuth = async (
    provider: 'github' | 'google' | 'gitlab' | 'azure'
  ) => {
    setError(null);
    await loginWithProvider(provider);
  };

  return (
    <Form {...form}>
      <form
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onSubmit={form.handleSubmit(onSubmit)}
        ref={formRef}
        className='space-y-4'
      >
        <FormDescription>{t('description_login')}</FormDescription>
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('form_label_email')}</FormLabel>
              <FormControl>
                <Input placeholder='votreadresse@email.fr' type='email' {...field} />
              </FormControl>
              <FormDescription>{t('form_descrition_email')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('form_label_password')}</FormLabel>
              <FormControl>
                <Input placeholder='mot de passe' {...field} type='password' />
              </FormControl>
              <FormDescription>{t('form_description_password')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {error !== null && (
          <div className="text-red-600 text-sm">
            {error}
          </div>
        )}

        {/* OAuth Buttons */}
        <div className="space-y-3">
          <Button
            type="button"
            onClick={() => void handleOAuth('github')}
            className="w-full bg-gray-800 text-white hover:bg-gray-700"
            disabled={loading}
          >
            {t('form_oauth_github')}
          </Button>

          <Button
            type="button"
            onClick={() => void handleOAuth('google')}
            className="w-full bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:hover:bg-gray-600"
            disabled={loading}
          >
            Connectez-vous via Google
          </Button>

          <Button
            type="button"
            onClick={() => void handleOAuth('gitlab')}
            className="w-full bg-orange-600 text-white hover:bg-orange-700"
            disabled={loading}
          >
            Connectez-vous via GitLab
          </Button>

          <Button
            type="button"
            onClick={() => void handleOAuth('azure')}
            className="w-full bg-blue-700 text-white hover:bg-blue-800"
            disabled={loading}
          >
            Connectez-vous via Azure
          </Button>
          <p className="mt-4 text-sm text-gray-600 dark:text-gray-400 text-center">
            {t('no_account')}{' '}
            <Link to="/register" className="text-blue-500 hover:underline"
              onClick={() => closeDialog?.()}>
              {t('btn_register')}
            </Link>
          </p>

        </div>
      </form>
    </Form>
  );
};

export default LoginForm;
