import { useAppSelector } from '@/hooks/hooks';
import { FormProps } from '@/hooks/ui/useDialog';
import useAppNavigation from '@/hooks/useAppNavigation';
import { supabase } from '@/utils/config';
import { selectManifestURL } from '@/state/selectors/manifests';
import { zodResolver } from '@hookform/resolvers/zod';
import i18next from 'i18next';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import Loading from '../Loading';
import { Form, FormControl, FormDescription, FormField, FormItem, FormMessage } from '../ui/form';
import { Input } from '@/components/ui/input.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Loader, Trash } from 'lucide-react';
import emailjs from '@emailjs/browser';

const contentFormSchema = z.object({
  mailInput: z.string().nonempty({ message: i18next.t('form_error_required') }),
});

interface ShareFormProps extends FormProps{
  path: string;
  manifestUrl: string;
}

const ShareManifestForm = ({ formRef, closeDialog, setCanSubmit, path, manifestUrl }: ShareFormProps) => {
  const currentManifestId = useAppSelector(selectManifestURL) ?? '';
  const { isLoading, loadedData, error } = useAppSelector((state) => state.manifests);
  const [loadindCall, setLoadingCall] = useState(false);
  const navigation = useAppNavigation();
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/add-access-right?object_path=${path}`;
  const [ token, setToken ] = useState<string | undefined>();
  const [mails, setMails] = useState<string[]>([]);

  const redirectionUrl : string =  `${window.location.origin}${import.meta.env.VITE_BASE_PATH ?? ''}/manifest?manifestId=`;

  const form = useForm<z.infer<typeof contentFormSchema>>({
    resolver: zodResolver(contentFormSchema),
    defaultValues: {
      mailInput: currentManifestId,
    },
    mode: 'all',
  });

  useEffect(() => {
    setCanSubmit(!isLoading);
  }, [isLoading]);

  useEffect(() => {
    async function goToManifestExplorer() {
      await navigation.goToManifestExplorer();
    }

    if (loadedData !== null) {
      void goToManifestExplorer();
      if (closeDialog) closeDialog();
    }
  }, [loadedData]);

  useEffect(() => {
    void getUserAllowed();
  }, []);

  if (isLoading) {
    return <Loading />;
  }

  async function sendMail(mail: string) {
    await emailjs.send(
      import.meta.env.VITE_EMAILJS_SERVICE_ID as string,
      import.meta.env.VITE_EMAILJS_TEMPLATE_ID_SEND_SHARING as string,
      {
        nom: "CorpuSense",
        email: mail,
        object: "Nouveau document partagé avec vous - CorpuSense",
        message: `Bonjour,\nVous avez été invité sur un nouveau document, vous pouvez y accéder via cet url : ${redirectionUrl + manifestUrl}`,
        title: "Nouveau manifest partagé sur CorpuSense"
      },
      import.meta.env.VITE_EMAILJS_PUBLIC_KEY as string,
    );
  }

  async function onSubmit(values: z.infer<typeof contentFormSchema>) {
    setLoadingCall(true);
    await fetch("https://zjahjagxmgcmoeisajnq.supabase.co/functions/v1/add-access-right", {
      headers: {
        Authorization: `Bearer ${token}`
      },
      method: "POST",
      body: JSON.stringify({object_path: path, email: values.mailInput }),
    });
    await sendMail(values.mailInput);
    await getUserAllowed();
  }

  async function removeUser(mail: string) {
    setLoadingCall(true);
    await fetch("https://zjahjagxmgcmoeisajnq.supabase.co/functions/v1/add-access-right", {
      headers: {
        Authorization: `Bearer ${token}`
      },
      method: "DELETE",
      body: JSON.stringify({object_path: path, email: mail }),
    });
    await getUserAllowed();
  }

  async function getUserAllowed(){
    setLoadingCall(true);
    const { data: { session } } = await supabase.auth.getSession();
    const _token = session?.access_token;
    setToken(_token);
    const headers = { 'Authorization': `Bearer ${_token}` };
    const res = await fetch(url, { headers });
    const data = await res.json() as { response: string[] };
    const _mails : string[] = data.response;
    setMails(_mails);
    setLoadingCall(false);
  }

  if (loadindCall) return <Loader />;

  return (
    <div>
      {mails.length > 0 && (
        <div>
          <p className={"font-bold mb-1"}>Utilisateurs déjà ajoutés</p>
          {mails.map((mail, index) => (
            <div key={index}>
            <div className={"flex flex-row justify-between w-full"}>
              <p className={"text-sm"}>{mail}</p>
              <Button
                className="text-red-500 bg-red-200 cursor-pointer"
                onClick={() => void removeUser(mail)}
              >
                <Trash />
              </Button>
            </div>
          {index < mails.length - 1 && <hr className="my-2" />}
            </div>
            ))}
        </div>
      )}
    <Form {...form}>
      <FormDescription>{"Partager à un utilisateur grâce à son adresse mail"}</FormDescription>
      <form
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onSubmit={form.handleSubmit(onSubmit)}
        className='flex w-full flex-col items-center space-y-4'
        ref={formRef}
      >
        <FormField
          control={form.control}
          name='mailInput'
          render={({ field }) => (
            <FormItem className='w-full'>
              <FormControl>
                <Input
                  {...field}
                  className='max-h-3.5 w-full resize-none'
                  placeholder={"Entrez une adresse mail"}
                  onChange={field.onChange}
                  onInput={field.onChange}
                  type={"email"}
                />
              </FormControl>
              <FormMessage>{error}</FormMessage>
            </FormItem>
          )}
        />
      </form>
    </Form>
    </div>
  );
};

export default ShareManifestForm;