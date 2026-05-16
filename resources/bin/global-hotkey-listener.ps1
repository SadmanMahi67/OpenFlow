$ErrorActionPreference = 'Stop'

Add-Type -ReferencedAssemblies 'System.Windows.Forms' -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class GlobalHotkeyBridge
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int VK_LCONTROL = 0xA2;
    private const int VK_RCONTROL = 0xA3;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;

    private static bool ctrlDown = false;
    private static bool winDown = false;
    private static bool engaged = false;
    private static IntPtr hookId = IntPtr.Zero;
    private static LowLevelKeyboardProc proc = HookCallback;

    public static void Run()
    {
        hookId = SetHook(proc);
        MSG message;

        while (GetMessage(out message, IntPtr.Zero, 0, 0) != 0)
        {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }

        if (hookId != IntPtr.Zero)
        {
            UnhookWindowsHookEx(hookId);
        }
    }

    private static IntPtr SetHook(LowLevelKeyboardProc callback)
    {
        using (Process process = Process.GetCurrentProcess())
        using (ProcessModule module = process.MainModule)
        {
            return SetWindowsHookEx(WH_KEYBOARD_LL, callback, GetModuleHandle(module.ModuleName), 0);
        }
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int vkCode = Marshal.ReadInt32(lParam);
            bool isDown = wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN;
            bool isUp = wParam == (IntPtr)WM_KEYUP || wParam == (IntPtr)WM_SYSKEYUP;

            if (vkCode == VK_LCONTROL || vkCode == VK_RCONTROL)
            {
                if (isDown) ctrlDown = true;
                if (isUp) ctrlDown = false;
            }

            if (vkCode == VK_LWIN || vkCode == VK_RWIN)
            {
                if (isDown) winDown = true;
                if (isUp) winDown = false;
            }

            bool comboActive = ctrlDown && winDown;

            if (!engaged && comboActive)
            {
                engaged = true;
                Console.Out.WriteLine("START");
                Console.Out.Flush();
                return (IntPtr)1;
            }

            if (engaged && !comboActive && isUp)
            {
                engaged = false;
                Console.Out.WriteLine("STOP");
                Console.Out.Flush();
                return (IntPtr)1;
            }

            if (engaged)
            {
                return (IntPtr)1;
            }
        }

        return CallNextHookEx(hookId, nCode, wParam, lParam);
    }

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
        public uint lPrivate;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int x;
        public int y;
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    private static extern sbyte GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage([In] ref MSG lpMsg);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage([In] ref MSG lpMsg);
}
"@

[GlobalHotkeyBridge]::Run()
